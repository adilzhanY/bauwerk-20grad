"""
Turns on the graphics card, first come first served, and each waiting job's place in line.

A route runs its model inside `with line.turn(job_id):`. The browser makes the id, sends it as
X-Job-Id with the upload, and asks GET /queue/<id> while it waits, so a person whose job is
behind someone else's sees how many are ahead instead of a clock that seems stuck. A job whose
browser stopped asking (the tab closed, Stop pressed) is dropped when its turn comes, so the
card does not work for nobody while others wait.

lod2-floorplan uses this same file through a symbolic link, so each service folder can still be
copied on its own.
"""
from __future__ import annotations

import re
import threading
import time
import uuid
from contextlib import contextmanager

JOB_ID = re.compile(r"^[A-Za-z0-9-]{8,64}$")
# The browser asks every second; this long without a question means nobody is waiting.
ABANDONED_S = 10.0


class Abandoned(Exception):
    """The job's turn came, but its browser stopped asking for it."""


class GpuLine:
    def __init__(self) -> None:
        self._cond = threading.Condition()
        # Job ids in arrival order; the first one has the card.
        self._line: list[str] = []
        # Job id -> when its browser last asked for its place, for ids the browser made.
        self._asked: dict[str, float] = {}

    def ahead(self, job_id: str) -> int | None:
        """How many jobs are before this one (0: it runs now), or None when it is not in line."""
        with self._cond:
            if job_id not in self._line:
                return None
            if job_id in self._asked:
                self._asked[job_id] = time.monotonic()
            return self._line.index(job_id)

    @contextmanager
    def turn(self, job_id: str | None):
        """Waits for this job's turn and holds the card until the block ends."""
        with self._cond:
            watched = job_id is not None and JOB_ID.match(job_id) is not None and job_id not in self._line
            key = job_id if watched else uuid.uuid4().hex
            self._line.append(key)
            if watched:
                self._asked[key] = time.monotonic()
            try:
                while self._line[0] != key:
                    self._cond.wait()
                if watched and time.monotonic() - self._asked[key] > ABANDONED_S:
                    raise Abandoned
            except BaseException:
                self._leave(key)
                raise
        try:
            yield
        finally:
            with self._cond:
                self._leave(key)

    def _leave(self, key: str) -> None:
        """Called with the condition held."""
        self._line.remove(key)
        self._asked.pop(key, None)
        self._cond.notify_all()
