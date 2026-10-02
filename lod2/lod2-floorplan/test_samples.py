"""
The real plans, read end to end with the room model (needs the GPU setup; skipped without it):

    .venv/bin/python test_samples.py

- The ground floor of BOo (sample-plans/DEBE02YY40000BOo-EG.png): 6 interior walls, 8 doors.
- A plan drawn out of proportion with BOo's footprint, with a title line just above the outline
  (lod2-floorplan/test_plans/haus-mueller-test.png): the outline must land on the drawn walls, not the title
  line, and the walls must come through; it read nothing before.
"""
import json
import subprocess
import sys
import tempfile
from pathlib import Path

import cv2
import numpy as np
from PIL import Image

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
    assert (len(r.walls), len(r.doors)) == (6, 8), (len(r.walls), len(r.doors))
    assert r.fit_error < 0.03, r.fit_error


def test_plan_out_of_proportion() -> None:
    r = read("haus-mueller-test.png")
    assert len(r.walls) >= 5 and len(r.doors) >= 3, (len(r.walls), len(r.doors))
    # The top edge of the outline on the drawn wall (about y = 70 px), not on the title (40 px).
    top = r.transform.to_px(FOOTPRINT)[:, 1].min()
    assert top > 60, top


def test_architect_sheet() -> None:
    """A whole A3 sheet (title block, legend, area schedule round the plan) from the BOo PDF:
    the drawing is found on the sheet and read; its outer walls are drawn filled and a little
    off the image axes, as the real outline is."""
    pdf = PLANS / "DEBE02YY40000BOo-Grundrisse.pdf"
    with tempfile.TemporaryDirectory() as tmp:
        subprocess.run(["pdftoppm", "-f", "2", "-l", "2", "-scale-to", "2400", "-png", str(pdf), f"{tmp}/p"], check=True)
        page = next(Path(tmp).glob("p*.png"))
        r = server.read_plan(Image.open(page).convert("RGB"), FOOTPRINT)
    assert len(r.walls) >= 6 and len(r.doors) >= 7, (len(r.walls), len(r.doors))
    # 2400 px across 420 mm at 1:100: 57.1 px per metre.
    assert abs(r.transform.scale - 57.1) < 2.0, r.transform.scale


if __name__ == "__main__":
    if not room_model.available():
        print("room model not installed: skipped")
        sys.exit(0)
    test_ground_floor_of_boo()
    test_plan_out_of_proportion()
    test_architect_sheet()
    print("sample plans: all checks passed")
