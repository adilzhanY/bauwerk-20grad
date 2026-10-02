"""
Floor plan service: interior walls and doors from a floor plan drawing, fitted into the
building's known outline.

  POST /walls   plan image + footprint (plan metres, JSON)  ->  interior walls and doors in
                plan metres, the fit of the outline on the drawing, and whether the room model
                (Raster2Seq) took part
  GET  /queue/<id>  how many AI jobs are ahead of this one (the browser sends <id> as X-Job-Id),
                    or {done: true} once its answer waits
  GET  /result/<id> the answer of a plan posted with "Prefer: respond-async" (which returns 202)
  GET  /health  whether the room model is installed

Listens on 127.0.0.1 only, like lod2-vision: a local tool behind the app's proxy.
See README.md for the setup, pipeline.py for how the plan is read.
"""
from __future__ import annotations

import io
import json
import hmac
import os
import tempfile
from pathlib import Path

import cv2
import numpy as np
import uvicorn
from fastapi import FastAPI, File, Form, Header, HTTPException, Request, UploadFile
from fastapi.responses import JSONResponse, Response
from PIL import Image, ImageOps

import pipeline
from gpu_queue import Abandoned, GpuLine, Jobs
import room_model

HOST = "127.0.0.1"
PORT = int(os.environ.get("LOD2_FLOORPLAN_PORT", "8791"))
MAX_SIDE = 3000
# One AI job at a time on this computer, in the order they came: the line is shared with
# lod2-vision, so a plan waits behind a photo and the other way round.
gpu_line = GpuLine()
jobs = Jobs()

# The shared secret the hosted site's proxy sends as X-Vision-Key (the same as lod2-vision's).
# Set, every request without it is refused: behind a Cloudflare Tunnel the service has a public
# address, and only the site, which checks the sign in first, may use the graphics card.
VISION_KEY = os.environ.get("VISION_KEY", "")

app = FastAPI(title="lod2-floorplan")


@app.middleware("http")
async def require_key(request: Request, call_next):
    """With VISION_KEY set, only the hosted site's proxy, which adds the key, gets through."""
    if VISION_KEY and not hmac.compare_digest(request.headers.get("x-vision-key", ""), VISION_KEY):
        return JSONResponse(status_code=401, content={"detail": "Missing or wrong X-Vision-Key."})
    return await call_next(request)


@app.get("/queue/{job_id}")
def queue(job_id: str) -> dict:
    """AI jobs ahead of this plan (0 while it is read), done once its answer waits, else 404."""
    if jobs.finished(job_id):
        return {"ahead": 0, "done": True}
    ahead = gpu_line.ahead(job_id)
    if ahead is None:
        raise HTTPException(404, "No such job in line.")
    return {"ahead": ahead}


@app.get("/result/{job_id}")
def result(job_id: str) -> Response:
    """A background plan's answer, once, with the status it would have had."""
    got = jobs.collect(job_id)
    if got is None:
        raise HTTPException(404, "No answer for this job.")
    status, body = got
    return JSONResponse(status_code=status, content=body)


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
def walls(
    plan: UploadFile = File(...),
    footprint: str = Form(...),
    x_job_id: str | None = Header(None),
    prefer: str | None = Header(None),
):
    image = _read_plan(plan)
    outline = _footprint(footprint)
    return jobs.respond(x_job_id, prefer, lambda: _read_walls(image, outline, x_job_id))


def _read_walls(image: Image.Image, outline: np.ndarray, job_id: str | None) -> dict:
    gray = cv2.cvtColor(np.array(image), cv2.COLOR_RGB2GRAY)
    rooms, doors = None, []
    try:
        with gpu_line.turn(job_id):
            if room_model.available():
                with tempfile.TemporaryDirectory() as tmp:
                    path = Path(tmp) / "plan.png"
                    image.save(path)
                    try:
                        rooms, doors = room_model.rooms_and_doors(path, image.width, image.height)
                    except Exception:  # noqa: BLE001 - the drawing alone still gives walls
                        rooms, doors = None, []
            result = pipeline.analyse(gray, outline, rooms, doors)
    except Abandoned as exc:
        raise HTTPException(409, "Nobody waits for this plan any more.") from exc
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
