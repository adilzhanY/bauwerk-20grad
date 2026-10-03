# lod2-vision

A local service that finds a wall's corners in a street photo and the windows and doors
on the rectified wall, with SAM 3. The viewer calls it through its `/vision` proxy when you
press **Detect openings** on a selected wall.

Nothing else in the project depends on it. Without it, the photo editor still works by hand.

## What it does

`POST /corners` takes the photo and the wall's width and height in metres, which the viewer
reads from the LoD2 model. SAM 3 masks the facade, the roof and anything parked in front.
The wall mask is facade minus roof minus occluders. Several candidate edge lines are fitted
to its outline, and the quad whose proportions are near the model wall's and that has the
most wall behind it wins. Occluders inside the quad are painted flat in the wall's median
colour, so a parked car cannot become a window. When more than 80 percent of the base is
hidden, the bottom edge is aimed at the vanishing point shared by the top edge and the
window rows, and the response says so. The viewer places the four dots and rectifies with
its own code.

`POST /openings` takes the rectified wall image at a known number of pixels per metre and
returns windows and doors in wall metres, origin bottom left, each with its confidence.

The reasoning behind these choices, and the measurements on the three sample photos, are in
the experiment write-up linked from the project README.

## Setup

The full steps, including the Hugging Face account, access to the gated model and the token, are in the project README under "Run it from zero". In short: Python 3.12, an NVIDIA GPU with about 6 GB free, PyTorch for your CUDA version, SAM 3 installed from a clone in `.sam3`, then `requirements.txt`.

```bash
cd lod2-vision
uv venv --python 3.12 .venv
source .venv/bin/activate
uv pip install torch==2.10.0 torchvision --index-url https://download.pytorch.org/whl/cu128
git clone https://github.com/facebookresearch/sam3.git .sam3
git -C .sam3 checkout 660a5e9           # the tested version
uv pip install ./.sam3
uv pip install -r requirements.txt
```

Then from the repo root:

```bash
npm run vision                         # port 8790
```

The model loads with the first job, not when the service starts, and is let go after 10 minutes without one (`LOD2_VISION_IDLE_MINUTES`): while nobody uses the site, the service holds about 0.2 GB on the graphics card and 1.5 GB of memory instead of 3.4 GB and 7 GB. The first job after a quiet spell waits about 25 seconds while the model loads; the site shows it working. The first load ever downloads about 3.4 GB into the Hugging Face cache (set `HF_HOME` in the root `.env` to move it). Loading onto a card that is too full (a game running) answers 503 with the out of memory message, like a job that does not fit.

`npm run vision` runs `scripts/vision.mjs`, which reads the repo-root `.env`, finds the Python in `.venv` (or `LOD2_VISION_PYTHON`), and starts `server.py`. Settings in `.env`: `HF_TOKEN`, `HF_HOME`, `LOD2_VISION_PORT` (default 8790) and `LOD2_VISION_PYTHON`. Variables already set in the shell win over the file.

`requirements.txt` pins `setuptools<81` on purpose: SAM 3 still imports `pkg_resources`, which newer setuptools no longer ships.

## Behaviour worth knowing

- The image encoder runs once per photo, and every prompt reuses it. Masks are enlarged to full size one at a time, straight into true/false, instead of all at once as 32-bit numbers. Together that cut a request's extra video memory from 4.8 GB to 1.3 GB and the corner search from 3.4 s to 2.2 s, with identical results.
- One job runs at a time. A second request waits for the first, because one model copy is shared and two at once could run the GPU out of memory.
- Out of GPU memory gives a 503 with a message instead of a crash.
- Without an NVIDIA GPU, or without access to the model on Hugging Face, the service stops at startup with one line that says what to do.
- Bad form values (a wall size of 0, a missing photo) give a 422 with a plain message the viewer shows as is.

## Known limits

- The bottom edge assumes a level pavement when the base is hidden. The model's contact
  line knows the real slope at both ends of the wall; mapping the bottom dots to those
  heights is the next step and needs a small change in `lod2-core`.
- A facade hidden by a fence or a hedge has no base to fit. The response reports the hidden
  fraction so the viewer can hand the bottom dots to the user.
- SAM 3 answers the prompt it is given: a glazed shop door is sometimes returned twice, as
  the frame and as its glazed leaf. The openings stay editable for that reason.
