# Facade Openings from One Photo

> **In the Bauwerk repository.** This guide comes from the lod2 challenge, where the LoD2 map ran as its own viewer on port 5175. The viewer is now part of the Bauwerk app. Every command runs from the repository root, and `npm run dev` starts the database, the API, the vision service (when installed) and the app together on **http://localhost:5173**. The steps below are updated for that; the details on the vision service, the ingest and the troubleshooting are unchanged.

Take one phone photo of a building's street wall and get every window and door on that wall as a rectangle in metres, plus the opening area and the window-to-wall ratio. The wall's true size comes from Berlin's free 3D building models (LoD2, the city's official 3D model of every building with its roof shape), so the numbers are real measurements, not guesses from pixels.

The use case is energy assessment. A consultant who today spends about ten minutes per wall with a tape measure or with manual drawing gets a checked, editable result in a few seconds of computing. Everything runs on open data and on SAM 3, a free image segmentation model from Meta whose licence allows commercial use.

When it runs, you get a map of Berlin in your browser. Click a building, click one of its walls in 3D, load a photo of that wall, and the windows and doors appear as editable boxes with their total area.

> **Quick look, about 15 minutes, no graphics card needed.** Install Node.js and Docker (step 1), then run steps 2 to 5. That gives you the map, the 3D view and the photo editor by hand. The automatic **Detect openings** button (steps 6 to 8) is optional and needs a Linux or WSL2 machine with an NVIDIA graphics card, plus about 30 to 45 minutes for downloads.

## Two pages that explain it

- **[From one phone photo to window area in square metres](https://claude.ai/artifact/VjHGRacafwEBED6sZtpoEr)** explains the geometry. It shows how four corner dots on a photo and the wall's size from the 3D model define a homography, how the photo is straightened into a flat wall image at 1 pixel per centimetre, and why a rectangle drawn on that image is already in metres. It also shows how the automatic workflow now places the four dots itself.
- **[One click, every window](https://claude.ai/artifact/9BK9JF2FaDGm1TdN2Wd16j)** explains the automatic workflow and the product around it. It walks through how SAM 3 finds the wall, hides parked cars and reads the windows, compares the results with hand measurement on three real buildings, and lists what it cannot do yet. Its Chapter 12 designs a production system (React frontend, NestJS API, PostgreSQL through Supabase, a GPU worker pool in an EU region) with load, cost and failure planning.

## What the app does

1. Find a building on the map of Berlin, or paste its Gebäude-ID into the search box.
2. Click a wall in the 3D view. The panel shows where the wall faces and its size above street level.
3. Press **Detect openings** and choose a photo of that wall. The vision service finds the wall's four corners, paints over parked cars, straightens the wall in the browser, and returns the windows and doors.
4. Check and edit. Every rectangle can be moved, resized, copied or deleted. The dots can be dragged with a magnifier if the base of the wall was hidden.
5. Read the result under the wall: number of openings, opening area in m², wall area in m², and the window-to-wall ratio.

Without the vision service the same editor works by hand: **Add photo**, drag the four dots, press **Apply**, draw the rectangles.

## How it is built

```
lod2-core/     pure TypeScript maths shared by every package: CityGML parser, wall planes,
               homography, rectification, openings, EXIF, zod schemas for every API response
lod2-ingest/   downloads Berlin's LoD2 tiles and loads them into PostGIS (CLI + migrations)
lod2-api/      Fastify HTTP API: vector tiles, building detail, orthophoto crops, on-demand ingest
lod2-vision/   Python FastAPI service around SAM 3: POST /corners and POST /openings
```

The browser does the straightening itself. The vision service only receives the photo for the corner search and the straightened wall image for the openings search. Only the vision service needs a GPU.

| Service | Port | Started with |
|---|---|---|
| PostGIS in Docker | 55433 | `npm run db` |
| API | 8788 | `npm run api` |
| Vision service | 8790 | `npm run vision` |
| The app (open this one) | 5173 | `npm run dev`, which starts all of the above too |

The app (`src/` at the repository root; the map, the 3D view and the photo editor are in `src/lod2/` and `src/pages/`) proxies `/api` to the API and `/vision` to the vision service, so the browser only talks to port 5173.

## Run it from zero

### 1. What you need

**For the map and the manual editor (any operating system):**

- **Node.js 22.18 or newer**, 24 recommended. Get it from https://nodejs.org, or with nvm (Linux, macOS) or nvm-windows. Check with `node --version`. The backend runs TypeScript files directly, which Node only supports from 22.18.
- **Docker.** Docker Desktop on Windows and macOS, Docker Engine with Compose v2 on Linux. **Start Docker before step 4.** On Apple Silicon Macs Docker prints a warning that the database image is for another platform; it still works.
- **Internet access** to `gdi.berlin.de` (the city's building models and aerial photos) and `sgx.geodatenzentrum.de` (the base map).
- **A terminal** opened in the project folder. On Windows, PowerShell works for steps 2 to 5.

**Only for the automatic detection (steps 6 to 8):**

- **Linux, or Windows with WSL2** (Ubuntu inside Windows, see https://learn.microsoft.com/windows/wsl/install). SAM 3 does not run on macOS or in plain Windows PowerShell. In WSL2, install Node.js and run the whole project inside the Ubuntu terminal, not half in Windows and half in WSL2.
- **An NVIDIA graphics card with about 6 GB of free video memory** and driver 570 or newer. `nvidia-smi` shows the driver version in its top line. In WSL2 the Windows NVIDIA driver is used; install nothing extra inside Ubuntu.
- **Python 3.12** and **uv**, a fast Python package installer: `curl -LsSf https://astral.sh/uv/install.sh | sh`
- **Git**, only to download SAM 3's code in step 7.
- **About 12 GB of free disk** for PyTorch, SAM 3's code and the model.
- **Internet access** to `huggingface.co`, `download.pytorch.org` and `github.com`.
- **A Hugging Face account** with access to SAM 3 (step 6).

### 2. Unzip and install

Open a terminal in the repository root, the folder that holds `package.json`. Then:

```bash
npm run setup
```

This installs the four TypeScript parts, in order, in about a minute. At the end npm reports "1 critical severity vulnerability". That is a known issue in the map library, explained under Known limits, and safe for local use.

### 3. Create your settings file

Linux, macOS, WSL2:

```bash
cp .env.example .env
```

Windows PowerShell:

```powershell
copy .env.example .env
```

All settings have working defaults, so for the map and the manual editor you can leave the file as it is. The file explains every setting. The only value you may fill in later is the Hugging Face token in step 6.

### 4. Start the database and load Berlin

```bash
npm run bootstrap
```

The first run takes a few minutes, because Docker downloads the database image once. It starts the database in Docker, creates its tables, downloads Berlin's list of map tiles, and loads the buildings of one area in Kreuzberg: 5 tiles, about 10 000 buildings. When it finishes without an error, `npm run status` lists the loaded tiles and their buildings.

If port 55433 is already used on your computer, set `LOD2_DB_PORT` in `.env` to a free port and change the port in `DATABASE_URL` to the same number.

You never need to load more by hand: when you move the map to another part of Berlin, the missing buildings are downloaded on the fly.

### 5. Start everything

```bash
npm run dev             # prints one line per service; the app is on http://localhost:5173/
```

Open **http://localhost:5173** in your browser. To try the photo editor by hand:

1. Type `DEBE02YY40000BOo` into the search field and pick the result. The building page opens.
2. In the 3D view, click the building's wall that faces the street, then press **Add photo** in the facade section.
3. Press **Choose photo** and pick `lod2/sample-photos/DEBE02YY40000BOo.jpg`.
4. Drag the four dots onto the wall's corners, press **Apply**, and draw rectangles over the windows. The energy numbers on the page follow.

When the vision service is not installed, `npm run dev` says so once and skips it; the **Detect windows** button stays hidden.

To stop everything: Ctrl+C, then `npm run db:stop` for the database.

### 6. Get access to SAM 3 on Hugging Face

Meta publishes SAM 3 on Hugging Face as a gated model: you ask for access once, then the service downloads it with a personal access token.

1. Create an account at https://huggingface.co/join, or log in.
2. Open https://huggingface.co/facebook/sam3. The page asks you to agree to share your contact information. Fill in the form, accept the SAM License, and submit.
3. Wait until the page shows that you have access. This is often quick, but it can take longer, and you get an email. The status is also listed at https://huggingface.co/settings/gated-repos.
4. Create a token at https://huggingface.co/settings/tokens: **Create new token**, token type **Read**, any name such as `lod2-vision`. Copy it. It starts with `hf_`.
5. Open `.env` in a text editor, find the line `# HF_TOKEN=hf_your_token_here`, remove the `#` and put your token after the `=`, with no quotes and no spaces: `HF_TOKEN=hf_abc123...`

Treat the token like a password. Keep it only in `.env`, and do not pass the folder on to anyone with your `.env` inside it.

The model is about 3.4 GB and is stored in `~/.cache/huggingface`. If that disk is small, set `HF_HOME` in `.env` to a folder on a bigger disk before step 8.

### 7. Install the vision service

In a Linux or WSL2 terminal, in the project folder:

```bash
cd lod2-vision
uv venv --python 3.12 .venv
source .venv/bin/activate

# PyTorch for CUDA 12.8 (about 3 GB). Keep cu128: it fits driver 570 and newer,
# and RTX 50 series cards need it.
uv pip install torch==2.10.0 torchvision --index-url https://download.pytorch.org/whl/cu128

# SAM 3 is not on PyPI. Download its code next to the service, at the tested version.
git clone https://github.com/facebookresearch/sam3.git .sam3
git -C .sam3 checkout 660a5e9
uv pip install ./.sam3

uv pip install -r requirements.txt
deactivate
cd ..
```

This takes 5 to 15 minutes, mostly downloads. Keep `.sam3` inside `lod2-vision/`. If it is deleted later, the service fails with `No module named 'sam3'`.

If you prefer `hf auth login` over the token line in `.env`, run it after `source .venv/bin/activate` and paste the token there.

### 8. Start the vision service

Restart `npm run dev`: it finds the installed service and starts it (or run `npm run vision` on its own).

The first start downloads the model, which takes a few minutes. Later starts take about 6 seconds. It is ready when it prints `lod2-vision ready on http://127.0.0.1:8790`. Within 15 seconds the building page shows **Detect windows** in the facade section. Press it on the street wall and choose the same sample photo: the dots, the straightened wall and the windows appear by themselves in a few seconds.

The service keeps about 3.4 GB of video memory while idle and needs about 1.3 GB more during a request. Requests run one at a time.

### Optional: developer checks

```bash
npm run check:lod2      # typecheck, lint and tests of lod2-core, lod2-ingest and lod2-api
npm run check           # the same plus the whole app
npm run build           # the app's production build
```

## From the building page to the editor

The building page computes the energy data of each building part with Bauwerk's own energy balance, from the city model, the photographed facades and the default windows for facades without a photo. **Sanierungsplanung starten** opens exactly that building in the editor (Ctrl+Z undoes the import).

What arrives in Bauwerk, and where each value comes from:

| Value | Source |
|---|---|
| Footprint | the LoD2 ground surface of the building part, cleaned and turned so the main walls run along the plan axes |
| Storeys | the rows of openings on the photo, else the eave height above the street divided by a typical storey height, else what you typed |
| Roof | the LoD2 roof type and its eave and ridge heights, simplified to flat, gable or hip |
| Windows and doors | the photographed walls, placed onto the matching footprint edge and storey |
| Party walls | walls that lie against a neighbour's footprint; they count without heat loss |
| Constructions | the official default U-values for the construction year (Bekanntmachung der Regeln zur Datenaufnahme im Wohngebäudebestand, 8 October 2020) |

Bauwerk shows the source next to each value and marks it as edited once you change it; its report gets a page "Herkunft der Werte" with every value and its source.

Bauwerk runs next to this project: clone it into a folder beside this one, `npm install --legacy-peer-deps`, then `npm run dev` (port 5173). Set `VITE_BAUWERK_URL` in `.env` if it runs elsewhere. `node scripts/check-bauwerk.mjs` runs the three sample buildings through Bauwerk's own importer and energy balance.

On the three sample buildings, pre-1918 constructions assumed:

| Building | Storeys | Openings | Party walls | Heating demand |
|---|---|---|---|---|
| DEBE02YY40000BOo | 4, from the photo | 25 | 264 m² | 174 kWh/(m²a), class F |
| DEBE02YY40000Atr | 4, from the photo | 24 | 479 m² | 165 kWh/(m²a), class F |
| DEBE02YY400000kY, tall block | 5, from the photo | 13 | 648 m² | 106 kWh/(m²a), class D |

## Troubleshooting

| What you see | Cause and fix |
|---|---|
| `http proxy error: /vision/health ... ECONNREFUSED 127.0.0.1:8790` in the app's output | The vision service is not running. Harmless. Start it with `npm run vision` if you want automatic detection. |
| `No Python found at .../lod2-vision/.venv/...` from `npm run vision` | The vision service is not installed yet. Do step 7, or set `LOD2_VISION_PYTHON` in `.env` to the Python you installed it into. |
| `ModuleNotFoundError: No module named 'sam3'` | SAM 3's code is missing from that Python. Clone it into `lod2-vision/.sam3` and run `uv pip install ./.sam3` again with the same Python (step 7). |
| `ModuleNotFoundError: No module named 'pkg_resources'` | setuptools is too new. Run `uv pip install "setuptools<81"` with the venv active. |
| Startup stops with a message about access to `facebook/sam3` | No token, a wrong token, or the access request is not approved yet. Check https://huggingface.co/settings/gated-repos, then step 6. |
| Startup says no NVIDIA GPU was found | SAM 3 needs CUDA. Check that `nvidia-smi` works in the same terminal. The manual editor still works without it. |
| A message about GPU memory, or the browser freezes while Detect openings runs | The graphics card is nearly full. Check with `nvidia-smi` while it runs, and close other programs that use the card. |
| `ERR_UNKNOWN_FILE_EXTENSION ".ts"` | Node.js is older than 22.18. Install a newer one. |
| `npm run bootstrap` fails with "Cannot connect to the Docker daemon" | Docker is not running. Start Docker Desktop or the Docker service and run it again. |
| `port is already allocated` from `npm run bootstrap` | Something else uses port 55433. See the note in step 4. |
| The map shows no buildings | The API is not running, or the database is empty. Open http://127.0.0.1:8788/health in the browser: it says which. |

## The data

| | |
|---|---|
| Building models | Berlin LoD2 CityGML, licence dl-de/zero-2-0, about 925 tiles on a 1 km grid |
| Orthophoto | Berlin TrueDOP20RGBI 2026, 20 cm, dl-de/zero-2-0 |
| Terrain | the models' own terrain contact lines (`bldg:lod2TerrainIntersection`) |
| Coordinates | ETRS89 / UTM zone 33 (EPSG:25833), heights in DHHN2016 |
| Basemap | basemap.de vector tiles, BKG |
| Model | SAM 3 by Meta, SAM License, commercial use allowed |

Berlin's CityGML has no addresses, so buildings are found by Gebäude-ID or by clicking the map. The three photos in `sample-photos/` are named after the building they show.

Panning the map sends requests to a public authority server. The API keeps them polite: nothing below zoom 14, at most 8 source tiles per map request, 2 downloads at a time, at least 250 ms between requests to one host, and a database lock so two processes never fetch the same tile. Please keep these limits.

## Measured results

On the three sample photos, automatic detection against careful hand measurement:

| Building | Openings, auto / hand | Opening area, auto / hand | Window-to-wall ratio, auto / hand |
|---|---|---|---|
| DEBE02YY40000BOo | 25 / 24 | 47.58 / 46.58 m² | 23.1 % / 22.6 % |
| DEBE02YY40000Atr | 24 / 24 | 59.94 / 57.81 m² | 24.6 % / 23.7 % |
| DEBE02YY400000kY | 13 / 12 | 27.52 / 24.82 m² | 20.0 % / 18.1 % |

The BOo row was re-run on 18 September 2026 after the fixes. The other two rows are from 17 September.

On an RTX 5070 with 12 GB, one wall took 6.2 seconds in total on 17 September: 4.4 s to find the wall, 52 ms to straighten it in the browser, 0.5 s to read the openings. Since the image encoder runs once per photo (18 September), finding the wall takes about 2.2 s and reading the openings about 0.3 s, with identical results. More detail is in [MEASUREMENTS.md](MEASUREMENTS.md) and in the second page linked above.

## Known limits

- **Sloped streets.** When the base of the wall is hidden, the bottom edge is assumed level. The model's contact line knows the real slope; mapping the bottom dots to those heights needs a rectification from four arbitrary target points in `lod2-core`.
- **Hidden base.** When a fence or a row of cars hides most of the base, the bottom dots come from perspective, and the editor says so with a warning. Check them before trusting heights.
- **Glazed doors** are sometimes returned twice, as the frame and as the glass leaf. Every opening is editable for that reason.
- **Leaning walls.** Walls up to 10 degrees from vertical are accepted but treated as vertical, which costs about 1 % of area at 8 degrees.
- **One flat ground level per wall.** The ground under a wall is one height averaged along its contact line, so the clipped wall outline is not exact on a slope.
- **Large photos** are straightened on the browser's main thread. A 24 megapixel photo can freeze the tab for about a second while the wall image is built.
- **Buildings with more than 500 surfaces** are drawn merged, so their walls cannot be clicked.
- **No accounts, no storage.** Photos and openings live in the browser tab and are gone when it closes. The production design in the second page covers persistence, users and load.
- **MapLibre 5 has a known security advisory** (an XSS bypass in its HTML sanitizer, used for popups, which this app does not show). The fix is MapLibre 6, a major upgrade that still needs testing in a browser.
- **One part per Bauwerk building.** A building with several LoD2 parts (kY has 11) sends only the part you photographed; the other parts count as heated neighbours. Bauwerk has one footprint for all storeys, so setbacks are not modelled.
- **Facades without a photo have no windows** in Bauwerk yet. Photograph the back too, or add them there by hand.
- **The construction year comes from you.** Berlin's LoD2 has none; until you set it, pre-1918 is assumed and the panel says so.
- **Storeys from window rows** assume one row per storey. A storey taller than 4.2 m is flagged, because a row was probably not seen.
- **Re-ingest keeps vanished buildings.** A building removed upstream stays in the database until the table is cleaned by hand.

## Other documents in the repo

- [MEASUREMENTS.md](MEASUREMENTS.md): the hand measurements on the sample photos.
- [WRITEUP.md](WRITEUP.md) and [CHALLENGE.md](CHALLENGE.md): where the project started, as an answer to a coding challenge.
- `presentation/`: the slides for this project, as a PDF and as a web page (`presentation/index.html`).
- `lod2-api/README.md`, `lod2-ingest/README.md`, `lod2-vision/README.md`: details per package.
