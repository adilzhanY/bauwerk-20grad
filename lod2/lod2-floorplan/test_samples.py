"""
The real plans, read end to end with the room model (needs the GPU setup; skipped without it):

    .venv/bin/python test_samples.py

- The ground floor of BOo (sample-plans/DEBE02YY40000BOo-EG.png): 6 interior walls, 8 doors.
- A plan drawn out of proportion with BOo's footprint, with a title line just above the outline
  (lod2-floorplan/test_plans/haus-mueller-test.png): the outline must land on the drawn walls, not the title
  line, and the walls must come through; it read nothing before.
"""
import json
import sys
from pathlib import Path

import cv2
import numpy as np
from PIL import Image

import pipeline
import room_model

HERE = Path(__file__).resolve().parent
PLANS = HERE.parent / "sample-plans"
TEST_PLANS = HERE / "test_plans"
FOOTPRINT = np.array([[p["x"], p["y"]] for p in json.loads((HERE / "boo_footprint.json").read_text())])


def read(name: str) -> pipeline.Result:
    path = PLANS / name if (PLANS / name).exists() else TEST_PLANS / name
    image = Image.open(path).convert("RGB")
    gray = cv2.cvtColor(np.array(image), cv2.COLOR_RGB2GRAY)
    rooms, doors = room_model.rooms_and_doors(path, image.width, image.height)
    return pipeline.analyse(gray, FOOTPRINT, rooms, doors)


def test_ground_floor_of_boo() -> None:
    r = read("DEBE02YY40000BOo-EG.png")
    assert (len(r.walls), len(r.doors)) == (6, 8), (len(r.walls), len(r.doors))
    assert r.fit_error < 0.03, r.fit_error


def test_plan_out_of_proportion() -> None:
    r = read("haus-mueller-test.png")
    assert len(r.walls) >= 5 and len(r.doors) >= 3, (len(r.walls), len(r.doors))
    # The top edge of the outline on the drawn wall (about y = 70 px), not on the title (40 px).
    top = r.transform.to_px(FOOTPRINT)[:, 1].min()
    assert top > 60, top


if __name__ == "__main__":
    if not room_model.available():
        print("room model not installed: skipped")
        sys.exit(0)
    test_ground_floor_of_boo()
    test_plan_out_of_proportion()
    print("sample plans: all checks passed")
