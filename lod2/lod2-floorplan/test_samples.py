"""
The real plans, read end to end with the room model (needs the GPU setup; skipped without it):

    .venv/bin/python test_samples.py

- The ground floor of BOo (sample-plans/DEBE02YY40000BOo-EG.png): 6 interior walls, 8 doors.
- A plan drawn out of proportion with BOo's footprint, with a title line just above the outline
  (lod2-floorplan/test_plans/haus-mueller-test.png): the outline must land on the drawn walls, not the title
  line, and the walls must come through; it read nothing before.
"""
import json
import math
import subprocess
import sys
import tempfile
from pathlib import Path

import cv2
import numpy as np
from PIL import Image
from shapely.geometry import LineString

import pipeline
import room_model
import server

HERE = Path(__file__).resolve().parent
PLANS = HERE.parent / "sample-plans"
TEST_PLANS = HERE / "test_plans"
FOOTPRINT = np.array([[p["x"], p["y"]] for p in json.loads((HERE / "boo_footprint.json").read_text())])


def read(name: str) -> pipeline.Result:
    path = PLANS / name if (PLANS / name).exists() else TEST_PLANS / name
    return server.read_plan(Image.open(path).convert("RGB"), FOOTPRINT)


def test_ground_floor_of_boo() -> None:
    r = read("DEBE02YY40000BOo-EG.png")
    # 8 doors are drawn; the one from the Diele to the Zimmer below is drawn so faintly, a
    # door leaf across it, that it is missed.
    assert (len(r.walls), len(r.doors)) == (6, 7), (len(r.walls), len(r.doors))
    assert r.fit_error < 0.03, r.fit_error


def test_plan_out_of_proportion() -> None:
    r = read("haus-mueller-test.png")
    assert len(r.walls) >= 5 and len(r.doors) >= 3, (len(r.walls), len(r.doors))
    # The top edge of the outline on the drawn wall (about y = 70 px), not on the title (40 px).
    top = r.transform.to_px(FOOTPRINT)[:, 1].min()
    assert top > 60, top


def test_architect_sheets() -> None:
    """The four A3 sheets of the BOo plan set (title block, legend and area schedule round
    each plan; walls filled or drawn as two thin lines; door labels and swing arcs in the
    openings), against the walls and doors the sheets were drawn from (make_boo_plans.py)."""
    sys.path.insert(0, str(PLANS))
    import make_boo_plans as drawn

    pdf = PLANS / "DEBE02YY40000BOo-Grundrisse.pdf"
    with tempfile.TemporaryDirectory() as tmp:
        subprocess.run(["pdftoppm", "-scale-to", "2400", "-png", str(pdf), f"{tmp}/p"], check=True)
        pages = sorted(Path(tmp).glob("p*.png"))
        found = [server.read_plan(Image.open(p).convert("RGB"), FOOTPRINT) for p in pages]
    missed = 0
    for storey, r in zip(drawn.STOREYS, found):
        # 2400 px across 420 mm at 1:100: 57.14 px per metre.
        assert abs(r.transform.scale - 57.14) < 0.3, (storey.code, r.transform.scale)
        # Every wall, each within a few centimetres of where it is drawn (a wall drawn in two
        # pieces on one line is read as one).
        walls = [LineString([w.a, w.b]) for w in storey.walls]
        for t in walls:
            mid = t.interpolate(0.5, normalized=True)
            assert min(w.line.distance(mid) for w in r.walls) < 0.06, (storey.code, "missed", t)
        for w in r.walls:
            mid = w.line.interpolate(0.5, normalized=True)
            assert min(t.distance(mid) for t in walls) < 0.06, (storey.code, "not drawn", w.a, w.b)
        # Every door in all four sheets, none where there is no door, each to the
        # width drawn within a few centimetres.
        doors = [(_on(d), d.width) for d in storey.doors]
        for d in r.doors:
            mid = ((d.a[0] + d.b[0]) / 2, (d.a[1] + d.b[1]) / 2)
            near = [width for at, width in doors if math.dist(at, mid) < 0.5]
            assert near, (storey.code, "no door drawn at", mid)
            assert abs(math.dist(d.a, d.b) - near[0]) < 0.15, (storey.code, mid, math.dist(d.a, d.b), near[0])
        missed += len(doors) - len(r.doors)
    assert missed == 0, missed


def _on(door) -> tuple[float, float]:
    """The middle of a door drawn by make_boo_plans, in plan metres."""
    (ax, ay), (bx, by) = door.wall.a, door.wall.b
    length = math.hypot(bx - ax, by - ay)
    return ax + (bx - ax) * door.centre / length, ay + (by - ay) * door.centre / length


if __name__ == "__main__":
    if not room_model.available():
        print("room model not installed: skipped")
        sys.exit(0)
    test_ground_floor_of_boo()
    test_plan_out_of_proportion()
    test_architect_sheets()
    print("sample plans: all checks passed")
