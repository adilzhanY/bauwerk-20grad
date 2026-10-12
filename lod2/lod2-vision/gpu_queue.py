"""
Turns on the graphics card, first come first served, and each waiting job's place in line.

There is one line for the whole computer, not one per service: lod2-vision (SAM 3) and
lod2-floorplan (the room model) share the card, so a photo waits behind a plan and the other
way round, and only one AI job ever runs at a time. The line is a folder of empty ticket files,
named so they sort in arrival order; the first ticket has the card. A service that dies leaves
its tickets behind, and they are cleared the next time anyone looks at the line.

A route runs its model inside `with line.turn(job_id):`. The browser makes the id, sends it as
X-Job-Id with the upload, and asks GET /queue/<id> while it waits, so a person whose job is
behind someone else's sees how many are ahead instead of a clock that seems stuck. A job whose
browser stopped asking (the tab closed, Stop pressed) is dropped when its turn comes, so the
card does not work for nobody while others wait.

`Jobs` lets an upload return at once (202) and its answer be collected later (GET /result/<id>),
so no single request waits in line: a proxy that cuts long requests (Cloudflare does after
100 seconds) never sees one, however long the line.

lod2-floorplan uses this same file through a symbolic link, so each service folder can still be
copied on its own.
"""
from __future__ import annotations

import os
import re
import tempfile
import threading
import time
import traceback
import uuid
from contextlib import contextmanager
from pathlib import Path
from typing import Callable

JOB_ID = re.compile(r"^[A-Za-z0-9-]{8,64}$")
# The browser asks every second; this long without a question means nobody is waiting.
ABANDONED_S = 10.0
# How often a waiting job looks whether its turn has come.
POLL_S = 0.05
# A finished answer waits this long for its browser to collect it.
KEEP_S = 600.0
# More jobs than this in the background, and new ones are turned away: a flood, not people.
MAX_JOBS = 12


def line_folder() -> Path:
    """The line's folder, the same for every service of this user on this computer."""
    base = os.environ.get("GPU_LINE_DIR") or os.path.join(
        os.environ.get("XDG_RUNTIME_DIR") or tempfile.gettempdir(), "bauwerk-gpu-line"
    )
    folder = Path(base)
    folder.mkdir(mode=0o700, parents=True, exist_ok=True)
    return folder


def _alive(pid: int) -> bool:
    try:
        os.kill(pid, 0)
    except ProcessLookupError:
        return False
    except PermissionError:
        return True
    return True


class Abandoned(Exception):
    """The job's turn came, but its browser stopped asking for it."""


class GpuLine:
    def __init__(self, folder: Path | None = None) -> None:
        self._folder = folder or line_folder()
        self._lock = threading.Lock()
        # This service's jobs: id -> its ticket's file name.
        self._tickets: dict[str, str] = {}
        # Job id -> when its browser last asked for its place, for ids the browser made.
        self._asked: dict[str, float] = {}

    def _line(self) -> list[str]:
        """Every live ticket on the computer, in arrival order. Dead services' tickets go."""
        names = []
        for name in os.listdir(self._folder):
            try:
                pid = int(name.split("-")[1])
            except (IndexError, ValueError):
                continue
            if pid != os.getpid() and not _alive(pid):
                (self._folder / name).unlink(missing_ok=True)
                continue
            names.append(name)
        return sorted(names)

    def ahead(self, job_id: str) -> int | None:
        """How many jobs are before this one (0: it runs now), or None when it is not in line."""
        with self._lock:
            ticket = self._tickets.get(job_id)
            if ticket is None:
                return None
            if job_id in self._asked:
                self._asked[job_id] = time.monotonic()
        line = self._line()
        return line.index(ticket) if ticket in line else None

    @contextmanager
    def turn(self, job_id: str | None):
        """Waits for this job's turn and holds the card until the block ends."""
        with self._lock:
            watched = job_id is not None and JOB_ID.match(job_id) is not None and job_id not in self._tickets
            key = job_id if watched else uuid.uuid4().hex
            ticket = f"{time.time_ns():020d}-{os.getpid()}-{key}"
            (self._folder / ticket).touch(exist_ok=False)
            self._tickets[key] = ticket
            if watched:
                self._asked[key] = time.monotonic()
        try:
            while True:
                line = self._line()
                if line and line[0] == ticket:
                    break
                if ticket not in line:
                    raise RuntimeError("This job's ticket left the line.")
                time.sleep(POLL_S)
            with self._lock:
                asked = self._asked.get(key)
            if watched and asked is not None and time.monotonic() - asked > ABANDONED_S:
                raise Abandoned
            yield
        finally:
            (self._folder / ticket).unlink(missing_ok=True)
            with self._lock:
                self._tickets.pop(key, None)
                self._asked.pop(key, None)


class Jobs:
    """Work started in the background under the browser's job id, its answer kept to collect."""

    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._running: set[str] = set()
        # Job id -> (when it finished, HTTP status, JSON body).
        self._done: dict[str, tuple[float, int, object]] = {}

    def start(self, job_id: str, work: Callable[[], object]) -> str | None:
        """Starts `work`; None when it runs, else why not (a bad or repeated id, too many jobs)."""
        if not JOB_ID.match(job_id):
            return "The job id is not usable."
        with self._lock:
            self._expire()
            if job_id in self._running or job_id in self._done:
                return "This job id is already in use."
            if len(self._running) >= MAX_JOBS:
                return "Too many AI jobs are waiting. Try again in a minute."
            self._running.add(job_id)
        threading.Thread(target=self._run, args=(job_id, work), daemon=True).start()
        return None

    def _run(self, job_id: str, work: Callable[[], object]) -> None:
        try:
            status, body = 200, work()
        except Exception as exc:  # noqa: BLE001 - every failure becomes the job's answer
            # HTTPException carries its own status and text; anything else is a 500.
            status = int(getattr(exc, "status_code", 500))
            detail = getattr(exc, "detail", None)
            if detail is None:
                # The details (paths, library internals) go to the log, not to the browser.
                traceback.print_exc()
                detail = "Internal error"
            body = {"detail": detail}
        with self._lock:
            self._running.discard(job_id)
            self._done[job_id] = (time.monotonic(), status, body)

    def respond(self, job_id: str | None, prefer: str | None, work: Callable[[], object]):
        """
        A route's answer: `work()` now, or, when the browser asked for it (Prefer:
        respond-async), 202 at once with the work started, its answer later from collect().
        """
        from fastapi import HTTPException
        from fastapi.responses import JSONResponse

        if job_id and prefer and "respond-async" in prefer.lower():
            refused = self.start(job_id, work)
            if refused:
                raise HTTPException(429 if refused.startswith("Too many") else 409, refused)
            return JSONResponse(status_code=202, content={"job": job_id})
        return work()

    def finished(self, job_id: str) -> bool:
        with self._lock:
            self._expire()
            return job_id in self._done

    def collect(self, job_id: str) -> tuple[int, object] | None:
        """The answer, once: (status, body), or None when there is none (yet)."""
        with self._lock:
            self._expire()
            done = self._done.pop(job_id, None)
        return None if done is None else (done[1], done[2])

    def _expire(self) -> None:
        """Called with the lock held: answers nobody collected are dropped after KEEP_S."""
        now = time.monotonic()
        for job_id in [j for j, (at, _, _) in self._done.items() if now - at > KEEP_S]:
            del self._done[job_id]
