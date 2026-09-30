"""
Floor plan service: interior walls and doors from a floor plan drawing, fitted into the
building's known outline.

  POST /walls   plan image + footprint (plan metres, JSON)  ->  interior walls and doors in
                plan metres, the fit of the outline on the drawing, and whether the room model
                (Raster2Seq) took part
  GET  /health  whether the room model is installed

Listens on 127.0.0.1 only, like lod2-vision: a local tool behind the app's proxy.
See README.md for the setup, pipeline.py for how the plan is read.
"""
from __future__ import annotations

import io
import json
import os
import tempfile
import threading
from pathlib import Path

import cv2
import numpy as np
import uvicorn
from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from PIL import Image, ImageOps

import pipeline
import room_model

HOST = "127.0.0.1"
PORT = int(os.environ.get("LOD2_FLOORPLAN_PORT", "8791"))
MAX_SIDE = 3000
# One plan at a time: the room model takes the graphics card while it runs.
lock = threading.Lock()

app = FastAPI(title="lod2-floorplan")


@app.get("/health")
def health() -> dict:
    return {"roomModel": room_model.available()}


def _read_plan(upload: UploadFile) -> Image.Image:
    try:
        image = ImageOps.exif_transpose(Image.open(io.BytesIO(upload.file.read())))
    except Exception as exc:  # noqa: BLE001 - any decoding failure is a bad upload
        raise HTTPException(422, "The file is not an image.") from exc
    image = image.convert("RGB")
    if max(image.size) > MAX_SIDE:
        image.thumbnail((MAX_SIDE, MAX_SIDE))
    return image


def _footprint(text: str) -> np.ndarray:
    try:
        points = np.array([[float(p["x"]), float(p["y"])] for p in json.loads(text)])
    except (ValueError, KeyError, TypeError) as exc:
        raise HTTPException(422, "footprint must be a JSON list of {x, y} points in metres.") from exc
    if len(points) < 3:
        raise HTTPException(422, "footprint needs at least three points.")
    return points


@app.post("/walls")
def walls(plan: UploadFile = File(...), footprint: str = Form(...)) -> dict:
    image = _read_plan(plan)
    outline = _footprint(footprint)
    gray = cv2.cvtColor(np.array(image), cv2.COLOR_RGB2GRAY)
    rooms, doors = None, []
    with lock:
        if room_model.available():
            with tempfile.TemporaryDirectory() as tmp:
                path = Path(tmp) / "plan.png"
                image.save(path)
                try:
                    rooms, doors = room_model.rooms_and_doors(path, image.width, image.height)
                except Exception:  # noqa: BLE001 - the drawing alone still gives walls
                    rooms, doors = None, []
        result = pipeline.analyse(gray, outline, rooms, doors)
    cm = lambda p: [round(float(p[0]), 2), round(float(p[1]), 2)]
    t = result.transform
    return {
        # Thickness: the gap between the wall's two drawn faces, metres, as the drawing shows it.
        "walls": [
            {"a": cm(w.a), "b": cm(w.b), "thickness": round(float(w.thickness), 3), "support": w.support}
            for w in result.walls
        ],
        "doors": [{"a": cm(d.a), "b": cm(d.b), "source": d.source} for d in result.doors],
        "fitError": round(result.fit_error, 3),
        "pixelsPerMetre": round(t.scale, 3),
        # Plan metres to image pixels, for drawing the result over the plan.
        "transform": {"scale": t.scale, "theta": t.theta, "ox": t.ox, "oy": t.oy},
        "imageSize": [image.width, image.height],
        "roomModel": result.used_model,
    }


if __name__ == "__main__":
    uvicorn.run(app, host=HOST, port=PORT, log_level="warning")
