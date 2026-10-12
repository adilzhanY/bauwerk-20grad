"""
Local vision service for the LoD2 viewer: SAM 3 behind two routes.

  POST /corners   photo + wall size in metres  ->  four corners, hidden-base fraction,
                  and the photo with occluders painted flat (base64 JPEG)
  POST /openings  rectified wall image + pixels per metre  ->  windows and doors in metres
  GET  /queue/<id>  how many jobs are ahead of this one (the browser sends <id> as X-Job-Id),
                  or {done: true} once its answer waits
  GET  /result/<id> the answer of a job posted with "Prefer: respond-async" (which returns 202)
  GET  /health    model, whether it is loaded, and the device

SAM 3 is loaded for the first job and let go after LOD2_VISION_IDLE_MINUTES (10) without one,
so the graphics card and the memory are free while nobody uses the site.

Listens on 127.0.0.1 unless LOD2_VISION_HOST says otherwise. With VISION_KEY set, every request
must carry it as X-Vision-Key (the hosted site's proxy adds it): behind the home PC's tunnel the
service has a public address. Listening beyond this computer without the key is refused.

Settings such as HF_TOKEN, HF_HOME and LOD2_VISION_PORT may come from the repo-root .env.
"""
from __future__ import annotations

import base64
import ctypes
import gc
import hmac
import io
import os
import sys
import threading
import time
import traceback
import warnings
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
from fastapi import FastAPI, File, Form, Header, HTTPException, Request, UploadFile  # noqa: E402
from fastapi.exceptions import RequestValidationError  # noqa: E402
from fastapi.responses import JSONResponse, Response  # noqa: E402
from huggingface_hub.errors import HfHubHTTPError, LocalEntryNotFoundError  # noqa: E402
from PIL import Image, ImageOps  # noqa: E402

# A photo is at most 40 megapixels; a bigger one (or a small file that claims to be) is refused
# with a 400 instead of decoded into gigabytes of memory.
Image.MAX_IMAGE_PIXELS = 40_000_000
warnings.simplefilter("error", Image.DecompressionBombWarning)

from gpu_queue import Abandoned, GpuLine, Jobs  # noqa: E402
from pipeline import Sam3, find_openings, find_wall, shrink  # noqa: E402

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
# One line for the card, shared with lod2-floorplan: one AI job at a time on this computer.
gpu_line = GpuLine()
# The model is let go after this long without a job; the next one loads it again (about 20 s).
IDLE_S = float(os.environ.get("LOD2_VISION_IDLE_MINUTES", "10")) * 60
model_lock = threading.Lock()
last_used = time.monotonic()
jobs = Jobs()


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


def model() -> Sam3:
    """SAM 3, loaded now if it is not (the first job after a quiet spell waits for it)."""
    global sam
    with model_lock:
        if sam is None:
            sam = load_model()
            sam.warm_up()
            print(f"SAM 3 loaded on {sam.device}", flush=True)
        return sam


def unload_when_idle() -> None:
    """Lets the model go once nobody has used it for IDLE_S: its gigabytes on the graphics card
    and in memory go back to the computer. Runs for the life of the service."""
    global sam
    while True:
        time.sleep(30)
        with model_lock:
            if sam is None or gpu_line_busy() or time.monotonic() - last_used < IDLE_S:
                continue
            sam = None
            gc.collect()
            release_gpu_cache()
            # Python's allocator keeps freed memory for itself; hand it back to the system.
            try:
                ctypes.CDLL("libc.so.6").malloc_trim(0)
            except OSError:
                pass
            print("SAM 3 let go after a quiet spell", flush=True)


def gpu_line_busy() -> bool:
    return running_jobs > 0


running_jobs = 0


@asynccontextmanager
async def lifespan(_: FastAPI):
    threading.Thread(target=unload_when_idle, daemon=True).start()
    print(f"lod2-vision ready on http://{HOST}:{PORT}  (SAM 3 loads with the first job)", flush=True)
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
    # The details (paths, library internals) go to the log, not to whoever sent the request.
    traceback.print_exception(exc)
    return JSONResponse(status_code=500, content={"detail": "Internal error"})


def read_image(upload: UploadFile) -> tuple[Image.Image, float]:
    """
    The upload decoded and reduced to the pipeline's working size, and the scale applied. SAM 3
    sees 1008 px anyway, so a waiting job holds a few megapixels instead of up to 40.
    """
    data = upload.file.read()
    try:
        image = Image.open(io.BytesIO(data))
        image.load()
    except Exception as exc:
        raise HTTPException(400, f"Not an image: {exc}") from exc
    # Phone photos carry their rotation in Exif; the viewer shows them rotated, so match it.
    return shrink(ImageOps.exif_transpose(image))


def release_gpu_cache() -> None:
    """
    Hand freed blocks back to the driver. PyTorch keeps everything it ever allocated for
    reuse, so after one 24 megapixel photo the process would sit on the whole card until
    it exits; released, it settles back to the model's own few gigabytes.
    """
    if torch.cuda.is_available():
        torch.cuda.empty_cache()


def run_model(job_id: str | None, job, *args):
    """
    One model job at a time, in the order they came. Out of memory becomes a 503; the error is
    dropped before the cache is released, because its traceback still holds the tensors that
    filled the card.
    """
    global last_used, running_jobs
    out_of_memory = False
    try:
        with gpu_line.turn(job_id):
            running_jobs += 1
            try:
                return job(model(), *args)
            except torch.OutOfMemoryError:
                out_of_memory = True
            except RuntimeError as exc:
                # Loading onto a full card fails as a CUDA error, not as OutOfMemoryError.
                if "out of memory" not in str(exc):
                    raise
                out_of_memory = True
            finally:
                running_jobs -= 1
                last_used = time.monotonic()
                release_gpu_cache()
    except Abandoned as exc:
        raise HTTPException(409, "Nobody waits for this job any more.") from exc
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


@app.get("/queue/{job_id}")
def queue(job_id: str) -> dict:
    """Jobs ahead of this one (0 while it runs), done once its answer waits, else 404."""
    if jobs.finished(job_id):
        return {"ahead": 0, "done": True}
    ahead = gpu_line.ahead(job_id)
    if ahead is None:
        raise HTTPException(404, "No such job in line.")
    return {"ahead": ahead}


@app.get("/result/{job_id}")
def result(job_id: str) -> Response:
    """A background job's answer, once, with the status it would have had."""
    got = jobs.collect(job_id)
    if got is None:
        raise HTTPException(404, "No answer for this job.")
    status, body = got
    return JSONResponse(status_code=status, content=body)


@app.get("/health")
def health() -> dict:
    loaded = sam
    return {"model": "sam3", "loaded": loaded is not None, "device": loaded.device if loaded else None, "gpu": gpu_memory()}


@app.post("/corners")
def corners(
    photo: UploadFile = File(...),
    wallWidth: float = Form(..., gt=0),
    wallHeight: float = Form(..., gt=0),
    x_job_id: str | None = Header(None),
    prefer: str | None = Header(None),
):
    # Corners and the painted photo come back in the reduced photo's pixels; the browser
    # rectifies from that painted photo, so the two always match.
    image, _ = read_image(photo)

    def work() -> dict:
        try:
            found = run_model(x_job_id, find_wall, image, wallWidth, wallHeight)
        except ValueError as exc:
            raise HTTPException(422, str(exc)) from exc
        buf = io.BytesIO()
        found.painted_photo.save(buf, format="JPEG", quality=90)
        return {
            "width": image.width,
            "height": image.height,
            "corners": found.corners,
            "baseHidden": round(found.base_hidden, 3),
            "bottomFromVanishingPoint": found.bottom_from_vanishing_point,
            "facadeScore": round(found.facade_score, 3),
            "facadePrompt": found.facade_prompt,
            "seconds": round(found.seconds, 2),
            "paintedPhoto": "data:image/jpeg;base64," + base64.b64encode(buf.getvalue()).decode("ascii"),
        }

    return jobs.respond(x_job_id, prefer, work)


@app.post("/openings")
def openings(
    image: UploadFile = File(...),
    pixelsPerMetre: float = Form(100.0, gt=0),
    x_job_id: str | None = Header(None),
    prefer: str | None = Header(None),
):
    rectified, scale = read_image(image)
    pixelsPerMetre *= scale

    def work() -> dict:
        found = run_model(x_job_id, find_openings, rectified, pixelsPerMetre)
        return {"openings": [asdict(o) for o in found]}

    return jobs.respond(x_job_id, prefer, work)


if __name__ == "__main__":
    uvicorn.run(app, host=HOST, port=PORT, log_level="warning")
