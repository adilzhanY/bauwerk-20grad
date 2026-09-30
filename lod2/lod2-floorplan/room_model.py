"""
Raster2Seq (Cornell, SIGGRAPH 2026, MIT) as the room model: rooms as labelled polygons and
doors as segments, in the input image's pixels.

It runs as a subprocess of its own checkout (RASTER2SEQ_DIR, set up by setup.sh) and exits
after each plan, so no graphics memory stays taken between plans. Without a checkout the
pipeline still works from the drawing alone, only less selective about what is a wall.
"""
from __future__ import annotations

import json
import os
import subprocess
import sys
import tempfile
from pathlib import Path

HERE = Path(__file__).resolve().parent
MODEL_DIR = Path(os.environ.get("RASTER2SEQ_DIR", HERE / ".raster2seq"))
PYTHON = os.environ.get("RASTER2SEQ_PYTHON", sys.executable)
# The CubiCasa5K checkpoint: trained on non-commercial data, fine for trying, not for selling.
CHECKPOINT = os.environ.get("RASTER2SEQ_CHECKPOINT", "hf:cubicasa5k")
SIZE = 256
DOOR, WINDOW, OUTDOOR = 10, 9, 0
TIMEOUT_S = 180


def available() -> bool:
    return (MODEL_DIR / "predict.py").is_file()


def rooms_and_doors(image_path: Path, width: int, height: int) -> tuple[list, list]:
    """(rooms, doors) in pixels of the original image. Raises when the model fails."""
    with tempfile.TemporaryDirectory() as tmp:
        src = Path(tmp) / "in"
        src.mkdir()
        (src / image_path.name).write_bytes(image_path.read_bytes())
        out = Path(tmp) / "out"
        env = {
            **os.environ,
            "PYTHONPATH": os.pathsep.join(str(MODEL_DIR / p) for p in ("models/ops", "diff_ras", "")),
        }
        subprocess.run(
            [PYTHON, "predict.py", "--dataset_name=cubicasa", f"--dataset_root={src}", f"--checkpoint={CHECKPOINT}",
             f"--output_dir={out}", "--semantic_classes=12", "--input_channels", "3", "--poly2seq", "--seq_len", "512",
             "--num_bins", "32", "--disable_poly_refine", "--dec_attn_concat_src", "--per_token_sem_loss", "--use_anchor",
             "--ema4eval", "--save_pred", "--batch_size", "1", "--num_workers", "0"],
            cwd=MODEL_DIR, env=env, check=True, capture_output=True, timeout=TIMEOUT_S,
        )
        found = next(out.rglob(f"{image_path.stem}.json"), None)
        if found is None:
            raise RuntimeError("Raster2Seq wrote no result")
        predictions = json.loads(found.read_text())
    # The model saw the plan fitted into 256 x 256 and padded: undo that.
    k = min(SIZE / height, SIZE / width)
    top, left = (SIZE - int(height * k)) // 2, (SIZE - int(width * k)) // 2
    back = lambda q: ((q[0] - left) / k, (q[1] - top) / k)
    rooms, doors = [], []
    for p in predictions:
        pts = [back(q) for q in p["segmentation"]]
        if p["category_id"] == DOOR:
            doors.append(pts[:2])
        elif p["category_id"] not in (WINDOW, OUTDOOR):
            rooms.append(pts)
    return rooms, doors
