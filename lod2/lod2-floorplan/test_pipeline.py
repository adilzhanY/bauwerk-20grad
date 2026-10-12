"""
Checks for pipeline.py on a synthetic plan with known answers. No room model, no GPU:

    .venv/bin/python test_pipeline.py

The plan is an L-shaped building drawn the way old plans are: outer and interior walls as
two parallel lines, a door as a gap with jamb ticks, a dimension line outside and one
inside, and a staircase. The walls and the door must come back within a few centimetres, and
neither the dimension lines nor the stairs may turn into walls.
"""
from __future__ import annotations

import math

import cv2
import numpy as np

from shapely.geometry import Polygon

import pipeline

SCALE = 40.0  # px per metre
ORIGIN = (60.0, 520.0)  # pixel of plan (0, 0)

# L-shaped outline in metres, counter-clockwise.
FOOTPRINT = np.array([[0, 0], [12, 0], [12, 10], [5, 10], [5, 6], [0, 6]], dtype=float)
# Interior walls (plan metres) and a door in the first one.
WALL_1 = ((4.0, 0.0), (4.0, 6.0))
WALL_2 = ((4.0, 3.0), (12.0, 3.0))
DOOR = (1.5, 2.4)  # along WALL_1, metres from y = 0


def px(p):
    return (int(round(ORIGIN[0] + SCALE * p[0])), int(round(ORIGIN[1] - SCALE * p[1])))


def draw() -> np.ndarray:
    img = np.full((600, 620), 235, np.uint8)
    rng = np.random.default_rng(1)
    img = (img - rng.integers(0, 25, img.shape)).astype(np.uint8)  # yellowed paper
    # Outer walls 0.3 m thick, drawn as old plans draw them: an outer face on the outline (as
    # LoD2 measures it) and an inner face. A plan with solid filled walls is less exact: the
    # outline can then sit anywhere across the wall's thickness.
    inner = Polygon(FOOTPRINT).buffer(-0.3, join_style=2)
    for ring in (FOOTPRINT, np.array(inner.exterior.coords)):
        cv2.polylines(img, [np.array([px(p) for p in ring])], True, 20, 2)
    # Interior walls: two faces 0.12 m apart (5 px), the door as a gap with jamb ticks.
    half = 0.06
    (x, y0), (_, y1) = WALL_1
    for d in (-half, half):
        cv2.line(img, px((x + d, y0)), px((x + d, DOOR[0])), 30, 1)
        cv2.line(img, px((x + d, DOOR[1])), px((x + d, y1)), 30, 1)
    for y in DOOR:
        cv2.line(img, px((x - half, y)), px((x + half, y)), 30, 1)
    (x0, y), (x1, _) = WALL_2
    for d in (-half, half):
        cv2.line(img, px((x0, y + d)), px((x1, y + d)), 30, 1)
    # Dimension lines: one outside along the bottom, one inside a room. Single thin lines.
    cv2.line(img, px((0, -0.8)), px((12, -0.8)), 40, 1)
    cv2.line(img, px((6, 4.0)), px((11, 4.0)), 40, 1)
    # Stairs: a ladder of treads 0.25 m apart in the upper wing.
    for i in range(10):
        yy = 6.5 + 0.25 * i
        cv2.line(img, px((6.0, yy)), px((8.0, yy)), 40, 1)
    return img


def near(a, b, tol):
    return math.dist(a, b) <= tol


def test_synthetic_plan():
    result = pipeline.analyse(draw(), FOOTPRINT)
    t = result.transform
    assert abs(t.scale - SCALE) / SCALE < 0.01, f"scale {t.scale:.2f} px/m, expected {SCALE}"
    assert result.fit_error < 0.05, f"outline fit off by {result.fit_error:.3f} m"

    found = [(w.a, w.b) for w in result.walls]
    assert len(found) == 2, f"expected 2 walls, found {len(found)}: {found}"
    for expected in (WALL_1, WALL_2):
        ok = any(
            (near(a, expected[0], 0.08) and near(b, expected[1], 0.08))
            or (near(a, expected[1], 0.08) and near(b, expected[0], 0.08))
            for a, b in found
        )
        assert ok, f"wall {expected} not found in {found}"

    assert len(result.doors) == 1, f"expected 1 door, found {result.doors}"
    door = result.doors[0]
    ys = sorted((door.a[1], door.b[1]))
    assert abs(ys[0] - DOOR[0]) < 0.08 and abs(ys[1] - DOOR[1]) < 0.08, f"door at {ys}, expected {DOOR}"
    print(f"ok: scale {t.scale:.2f} px/m, fit {result.fit_error * 100:.1f} cm, 2 walls, door {ys[1] - ys[0]:.2f} m")


if __name__ == "__main__":
    test_synthetic_plan()
