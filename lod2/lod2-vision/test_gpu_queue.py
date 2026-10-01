"""
Checks for gpu_queue.py, no model and no GPU needed:

    .venv/bin/python test_gpu_queue.py
"""
from __future__ import annotations

import threading
import time

import gpu_queue
from gpu_queue import Abandoned, GpuLine


def wait_until(check, seconds: float = 2.0) -> None:
    end = time.monotonic() + seconds
    while not check():
        assert time.monotonic() < end, "timed out"
        time.sleep(0.01)


def test_turns_in_order_with_places() -> None:
    line = GpuLine()
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
    line = GpuLine()
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
    line = GpuLine()
    with line.turn("../../etc"):
        # Run, but under an id of its own, so nobody can ask for it by that name.
        assert line.ahead("../../etc") is None


if __name__ == "__main__":
    test_turns_in_order_with_places()
    test_drops_a_job_nobody_asks_for()
    test_odd_ids_are_not_trusted()
    print("gpu_queue: all checks passed")
