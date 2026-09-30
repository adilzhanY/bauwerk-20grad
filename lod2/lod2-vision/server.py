"""
Local vision service for the LoD2 viewer: SAM 3 behind two routes.

  POST /corners   photo + wall size in metres  ->  four corners, hidden-base fraction,
                  and the photo with occluders painted flat (base64 JPEG)
  POST /openings  rectified wall image + pixels per metre  ->  windows and doors in metres
  GET  /health    model and device

Listens on 127.0.0.1 only. There is no authentication, like lod2-api, and for the same
reason: it is a localhost tool.

Settings such as HF_TOKEN, HF_HOME and LOD2_VISION_PORT may come from the repo-root .env.
"""
from __future__ import annotations

import base64
import hmac
import io
import os
import sys
import threading
from contextlib import asynccontextmanager
from dataclasses import asdict
from pathlib import Path


def load_env_file(path: Path) -> None:
    """KEY=VALUE lines into os.environ. Blank and # lines are skipped; set variables win."""
    if not path.is_file():
        return
    for line in path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = (part.strip() for part in line.split("=", 1))
        if len(value) >= 2 and value[0] == value[-1] and value[0] in "'\"":
            value = value[1:-1]
        os.environ.setdefault(key, value)


# Before torch and huggingface_hub are imported, because they read HF_HOME at import time.
load_env_file(Path(__file__).resolve().parent.parent.parent / ".env")
# Apple chips: operations the GPU lacks fall back to the processor instead of failing.
os.environ.setdefault("PYTORCH_ENABLE_MPS_FALLBACK", "1")
# A copy of the model shipped next to this file (the demo zip): use it, download nothing.
BUNDLED_MODEL = Path(__file__).resolve().parent / "model"
if BUNDLED_MODEL.is_dir():
    os.environ.setdefault("HF_HUB_CACHE", str(BUNDLED_MODEL))
    os.environ.setdefault("HF_HUB_OFFLINE", "1")

import torch  # noqa: E402
import uvicorn  # noqa: E402
from fastapi import FastAPI, File, Form, HTTPException, Request, UploadFile  # noqa: E402
from fastapi.exceptions import RequestValidationError  # noqa: E402
from fastapi.responses import JSONResponse  # noqa: E402
from huggingface_hub.errors import HfHubHTTPError, LocalEntryNotFoundError  # noqa: E402
from PIL import Image, ImageOps  # noqa: E402

from pipeline import Sam3, find_openings, find_wall  # noqa: E402

# Loopback on the development PC. On a rented GPU instance the provider's proxy has to reach
# it: LOD2_VISION_HOST=0.0.0.0 there, and then VISION_KEY must be set (below).
HOST = os.environ.get("LOD2_VISION_HOST", "127.0.0.1")
PORT = int(os.environ.get("LOD2_VISION_PORT", "8790"))
# The shared secret the hosted app's proxy sends as X-Vision-Key. Set, every request without
# it is refused, so nobody who finds the address can use the GPU. Unset on the development PC.
VISION_KEY = os.environ.get("VISION_KEY", "")
if HOST != "127.0.0.1" and not VISION_KEY:
    print("lod2-vision: listening beyond this computer needs VISION_KEY; refusing to start.", file=sys.stderr)
    sys.exit(2)

HF_HELP = (
    "Could not get SAM 3 from Hugging Face. Accept the licence at https://huggingface.co/facebook/sam3, "
    "then run `hf auth login` or set HF_TOKEN in the repo-root .env, and start again."
)
OUT_OF_MEMORY = "The GPU ran out of memory on this image. Close other programs that use the GPU and try again."

sam: Sam3 | None = None
# One model serves every request, and sync routes run in a thread pool, so jobs take turns.
gpu_lock = threading.Lock()


def fail(message: str) -> None:
    """One clear line instead of a traceback, then exit."""
    print(message, file=sys.stderr, flush=True)
    sys.stdout.flush()
    os._exit(1)


def load_model() -> Sam3:
    print("Loading SAM 3 (first start downloads about 3.4 GB)...", flush=True)
    try:
        return Sam3()
    except (HfHubHTTPError, LocalEntryNotFoundError) as exc:
        fail(f"{HF_HELP}\n({type(exc).__name__}: {str(exc).splitlines()[0]})")


@asynccontextmanager
async def lifespan(_: FastAPI):
    global sam
    sam = load_model()
    # Before "ready", so the first photo is as fast as every later one.
    sam.warm_up()
    print(f"lod2-vision ready on http://{HOST}:{PORT}  (SAM 3 on {sam.device})", flush=True)
    yield


app = FastAPI(title="lod2-vision", lifespan=lifespan)


@app.middleware("http")
async def require_key(request: Request, call_next):
    """With VISION_KEY set, only the hosted app's proxy, which adds the key, gets through."""
    if VISION_KEY and not hmac.compare_digest(request.headers.get("x-vision-key", ""), VISION_KEY):
        return JSONResponse(status_code=401, content={"detail": "Missing or wrong X-Vision-Key."})
    return await call_next(request)


@app.exception_handler(RequestValidationError)
async def validation_error(_: Request, exc: RequestValidationError) -> JSONResponse:
    """FastAPI answers bad form fields with a list; the viewer expects one string."""
    problems = [f"{'.'.join(str(p) for p in e['loc'][1:])}: {e['msg']}" for e in exc.errors()]
    return JSONResponse(status_code=422, content={"detail": "; ".join(problems)})


@app.exception_handler(Exception)
async def unexpected_error(_: Request, exc: Exception) -> JSONResponse:
    return JSONResponse(status_code=500, content={"detail": f"Internal error: {type(exc).__name__}: {exc}"})


def read_image(upload: UploadFile) -> Image.Image:
    data = upload.file.read()
    try:
        image = Image.open(io.BytesIO(data))
        image.load()
    except Exception as exc:
        raise HTTPException(400, f"Not an image: {exc}") from exc
    # Phone photos carry their rotation in Exif; the viewer shows them rotated, so match it.
    return ImageOps.exif_transpose(image)


def release_gpu_cache() -> None:
    """
    Hand freed blocks back to the driver. PyTorch keeps everything it ever allocated for
    reuse, so after one 24 megapixel photo the process would sit on the whole card until
    it exits; released, it settles back to the model's own few gigabytes.
    """
    if torch.cuda.is_available():
        torch.cuda.empty_cache()


def run_model(job, *args):
    """
    One model job at a time. Out of memory becomes a 503; the error is dropped before the
    cache is released, because its traceback still holds the tensors that filled the card.
    """
    assert sam is not None
    with gpu_lock:
        out_of_memory = False
        try:
            return job(sam, *args)
        except torch.OutOfMemoryError:
            out_of_memory = True
        finally:
            release_gpu_cache()
    if out_of_memory:
        raise HTTPException(503, OUT_OF_MEMORY)


def gpu_memory() -> dict:
    if not torch.cuda.is_available():
        return {}
    gib = 1024 ** 3
    return {
        "allocatedGiB": round(torch.cuda.memory_allocated() / gib, 2),
        "reservedGiB": round(torch.cuda.memory_reserved() / gib, 2),
        "peakGiB": round(torch.cuda.max_memory_allocated() / gib, 2),
    }


@app.get("/health")
def health() -> dict:
    return {"model": "sam3", "device": sam.device if sam else None, "gpu": gpu_memory()}


@app.post("/corners")
def corners(
    photo: UploadFile = File(...),
    wallWidth: float = Form(..., gt=0),
    wallHeight: float = Form(..., gt=0),
) -> dict:
    image = read_image(photo)
    try:
        result = run_model(find_wall, image, wallWidth, wallHeight)
    except ValueError as exc:
        raise HTTPException(422, str(exc)) from exc
    buf = io.BytesIO()
    result.painted_photo.save(buf, format="JPEG", quality=90)
    return {
        "width": image.width,
        "height": image.height,
        "corners": result.corners,
        "baseHidden": round(result.base_hidden, 3),
        "bottomFromVanishingPoint": result.bottom_from_vanishing_point,
        "facadeScore": round(result.facade_score, 3),
        "facadePrompt": result.facade_prompt,
        "seconds": round(result.seconds, 2),
        "paintedPhoto": "data:image/jpeg;base64," + base64.b64encode(buf.getvalue()).decode("ascii"),
    }


@app.post("/openings")
def openings(image: UploadFile = File(...), pixelsPerMetre: float = Form(100.0, gt=0)) -> dict:
    rectified = read_image(image)
    found = run_model(find_openings, rectified, pixelsPerMetre)
    return {"openings": [asdict(o) for o in found]}


if __name__ == "__main__":
    uvicorn.run(app, host=HOST, port=PORT, log_level="warning")
