"""
Checks for gpu_queue.py, no model and no GPU needed:

    .venv/bin/python test_gpu_queue.py
"""
from __future__ import annotations

import multiprocessing
import os
import tempfile
import threading
import time
from pathlib import Path

import gpu_queue
from gpu_queue import Abandoned, GpuLine, Jobs


def wait_until(check, seconds: float = 3.0) -> None:
    end = time.monotonic() + seconds
    while not check():
        assert time.monotonic() < end, "timed out"
        time.sleep(0.01)


def folder() -> Path:
    """A line of its own, so the checks never queue behind a running service."""
    return Path(tempfile.mkdtemp(prefix="gpu-line-"))


def test_turns_in_order_with_places() -> None:
    line = GpuLine(folder())
    order: list[str] = []
    release = threading.Event()

    def job(name: str, hold: bool) -> None:
        with line.turn(f"job-{name}-0000"):
            order.append(name)
            if hold:
                release.wait(2)

    first = threading.Thread(target=job, args=("a", True))
    first.start()
    wait_until(lambda: line.ahead("job-a-0000") == 0)
    later = [threading.Thread(target=job, args=(n, False)) for n in ("b", "c")]
    for i, t in enumerate(later):
        t.start()
        wait_until(lambda i=i: line.ahead(f"job-{'bc'[i]}-0000") == i + 1)
    assert line.ahead("job-c-0000") == 2
    assert line.ahead("unknown-job") is None
    release.set()
    for t in [first, *later]:
        t.join(2)
    assert order == ["a", "b", "c"], order
    assert line.ahead("job-a-0000") is None


def test_drops_a_job_nobody_asks_for() -> None:
    gpu_queue.ABANDONED_S = 0.05
    line = GpuLine(folder())
    release = threading.Event()
    outcome: list[str] = []

    def holder() -> None:
        with line.turn("job-holder-00"):
            release.wait(2)

    def waiter(job_id: str | None) -> None:
        try:
            with line.turn(job_id):
                outcome.append("ran")
        except Abandoned:
            outcome.append("dropped")

    threading.Thread(target=holder).start()
    wait_until(lambda: line.ahead("job-holder-00") == 0)
    # One job whose browser never asks again, one without an id: only the first is dropped.
    watched = threading.Thread(target=waiter, args=("job-gone-0000",))
    plain = threading.Thread(target=waiter, args=(None,))
    watched.start()
    wait_until(lambda: line.ahead("job-gone-0000") == 1)
    plain.start()
    time.sleep(0.2)
    release.set()
    watched.join(2)
    plain.join(2)
    assert outcome == ["dropped", "ran"], outcome
    gpu_queue.ABANDONED_S = 10.0


def test_odd_ids_are_not_trusted() -> None:
    line = GpuLine(folder())
    with line.turn("../../etc"):
        # Run, but under an id of its own, so nobody can ask for it by that name.
        assert line.ahead("../../etc") is None


def _other_service(path: str, started, release, log: str) -> None:
    """A second service (its own process) holding the card until told to let go."""
    line = GpuLine(Path(path))
    with line.turn("job-other-0000"):
        Path(log).write_text("other ran\n")
        started.set()
        release.wait(5)


def test_one_line_for_every_service_on_the_computer() -> None:
    path = folder()
    started, release = multiprocessing.Event(), multiprocessing.Event()
    log = path.parent / f"{path.name}.log"
    other = multiprocessing.Process(target=_other_service, args=(str(path), started, release, str(log)))
    other.start()
    assert started.wait(5)
    line = GpuLine(path)
    ran: list[float] = []

    def mine() -> None:
        with line.turn("job-mine-0000"):
            ran.append(time.monotonic())

    t = threading.Thread(target=mine)
    t.start()
    # The other service's job has the card, so this one waits behind it.
    wait_until(lambda: line.ahead("job-mine-0000") == 1)
    time.sleep(0.2)
    assert ran == []
    release.set()
    other.join(5)
    t.join(3)
    assert len(ran) == 1


def test_a_dead_service_does_not_block_the_line() -> None:
    path = folder()
    # A ticket left by a process that is gone (pid 2**22 + 1 is beyond the usual pid range).
    (path / f"{1:020d}-{2**22 + 1}-job-ghost-000").touch()
    line = GpuLine(path)
    with line.turn("job-alive-0000"):
        assert line.ahead("job-alive-0000") == 0
    assert os.listdir(path) == []


def test_background_jobs_keep_their_answer() -> None:
    jobs = Jobs()
    gate = threading.Event()

    def work() -> dict:
        gate.wait(2)
        return {"walls": 3}

    assert jobs.start("job-walls-0000", work) is None
    assert jobs.start("job-walls-0000", work) == "This job id is already in use."
    assert jobs.start("bad id", work) == "The job id is not usable."
    assert not jobs.finished("job-walls-0000")
    gate.set()
    wait_until(lambda: jobs.finished("job-walls-0000"))
    assert jobs.collect("job-walls-0000") == (200, {"walls": 3})
    # Collected once, then gone.
    assert jobs.collect("job-walls-0000") is None


def test_a_failed_job_answers_with_its_status() -> None:
    from fastapi import HTTPException

    jobs = Jobs()

    def refused() -> dict:
        raise HTTPException(503, "The GPU ran out of memory.")

    def broken() -> dict:
        raise ValueError("bad plan")

    jobs.start("job-oom-00000", refused)
    jobs.start("job-broken-000", broken)
    wait_until(lambda: jobs.finished("job-oom-00000") and jobs.finished("job-broken-000"))
    assert jobs.collect("job-oom-00000") == (503, {"detail": "The GPU ran out of memory."})
    status, body = jobs.collect("job-broken-000")
    assert status == 500 and "bad plan" in body["detail"]


def test_a_flood_is_turned_away() -> None:
    jobs = Jobs()
    gate = threading.Event()
    for n in range(gpu_queue.MAX_JOBS):
        assert jobs.start(f"job-flood-{n:04d}", lambda: gate.wait(2)) is None
    assert (jobs.start("job-flood-extra", lambda: None) or "").startswith("Too many")
    gate.set()


if __name__ == "__main__":
    test_turns_in_order_with_places()
    test_drops_a_job_nobody_asks_for()
    test_odd_ids_are_not_trusted()
    test_one_line_for_every_service_on_the_computer()
    test_a_dead_service_does_not_block_the_line()
    test_background_jobs_keep_their_answer()
    test_a_failed_job_answers_with_its_status()
    test_a_flood_is_turned_away()
    print("gpu_queue: all checks passed")
