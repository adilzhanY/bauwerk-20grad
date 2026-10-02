# lod2-floorplan

A local service that reads an old floor plan drawing into interior walls and doors. The editor calls it through its `/floorplan` proxy from the Underlay tab (**Read floor plan**), shows the result over the drawing, and applies it to the active storey as one undo step.

Nothing else in the project depends on it. Without it, the Underlay tab simply does not offer the import.

## What it does

The building's outline is already known from LoD2, to the centimetre. So the service does not have to guess the building. It has to find the drawing's scale and position, and then look for walls only inside that outline.

0. **Find the drawing on the sheet.** An architect's sheet (A3 with a title block, a legend and an area schedule round the plan) is cut down to the plan first: the cluster with the most wall-like ink, with a margin.
1. **Register.** The known footprint is matched onto the wall-like ink of the drawing (chamfer distance, a multi-start search over scale, rotation and shift). The size of the drawn building bounds the scale from below, so the outline cannot shrink onto a grid of interior walls (which can fit the ink better than the real outline). With the room model, only wall ink near its rooms counts: a drawing is rarely in exact proportion with the measured building, and a title line or a frame just outside the plan would otherwise pull the outline half a metre off. Among fits nearly as good as the best the largest wins (with the model, the largest that keeps its rooms inside). Last, every point of the outline looks across the outer wall for its outer face, and scale, turn and shift are solved by least squares onto those points (windows and stains drop out): on a sheet at 1:100 the scale comes out at 57.0 px/m where the paper says 57.14. When the model's rooms cover less than 40 percent of the drawn building, it failed on that drawing and its rooms are not used.
2. **Walls from the drawing.** Old plans draw a wall as two parallel lines 6 to 32 cm apart, or as one thick stroke. Those are found in the drawing; a piece of ink that is too thick as a whole (an interior wall carrying on the line of a thicker outer wall) is measured across at every step and cut into its wall-thick runs. Ladders of parallel lines (stairs), single thin lines (dimensions) and anything along the outer wall are dropped. Pieces on one line are joined and their ends are carried to the outline (along the wall) or to the wall they meet; a wall ending at a corner of the outline lines up with it, and a free end a door's width short of another wall, with a stub of wall drawn there, is carried across the door.
3. **Checked against the room model.** Raster2Seq (trained on CubiCasa5K) predicts room polygons and doors. A wall at least 60 percent on a predicted room boundary is confirmed, and stays when it is held by the outline or another wall: at both ends, or at one end when it is at least 2 m long (a wall may end free at a passage). The model at 256 pixels often runs small rooms into one, so a wall it does not confirm stays when the drawing makes the case: drawn along at least 70 percent of its length, not running along the outline, and held at both ends by the outline or established walls, in order from the outline in (the sides of a text box only hold each other). Pieces on one line up to 2 m apart are one wall with an opening. The model decides which walls are likely, the drawing where they are.
4. **Room names.** Tesseract (`deu+eng`) reads the words on the plan; the ones inside the building go back with their place in plan metres, together with the room model's room types (kitchen, bath, bedroom...). The editor matches the words against its dictionary of German and English room names (`src/geometry/roomNames.ts`: old names, abbreviations like WZ or HWR, a letter or two misread) and names each room after the best words inside it, else after the room type. Without Tesseract the plan is read without names.
5. **Doors.** A door is where the wall stops: a gap between two wall pieces, a spot the model marks as a door, or an opening found by scanning every wall, each measured in the ink across the wall. Where the wall is drawn as two lines, it is open where the lines stop (the door's label and swing arc in the opening add ink, but not as two lines along the wall); else where the ink across drops. An opening only the scan found needs wall on both sides, may not sit where another wall meets this one, and is none if the wall's two lines run on through it. Widths from 0.5 to 1.55 m (a double door of 1.51 m, DIN 18101).

`POST /walls` takes the plan image and the footprint in plan metres (a JSON list of `{x, y}`) and returns the walls and doors in the same metres, to the centimetre (each wall with its measured thickness, the gap between its two drawn faces), together with the fit error of the outline, the scale, the transform to image pixels, whether the room model took part, the words read inside the building (`labels`) and the room types (`roomKinds`). `GET /health` says whether the room model is installed.

On the ground floor plan of BOo (`lod2/sample-plans/`) it fits the outline to 1.7 cm at 49.9 px/m and finds 6 interior walls and 8 doors, which make the 8 rooms of the drawing in the editor. The entrance door comes out at 0.96 m; the plan writes 0.945. On `test_plans/haus-mueller-test.png`, drawn out of proportion with BOo's footprint and with a title line just above the outline, it finds 5 walls and 4 doors (it found nothing before the room-guided fit). On the four A3 sheets of `DEBE02YY40000BOo-Grundrisse.pdf` (made by `sample-plans/make_boo_plans.py`) it finds every wall, each within 6 cm of where it is drawn, and all 43 doors, with no false ones, each within 15 cm of its drawn width (most within 5); the editor makes every room of the sheets and names them as the sheets do. On the old scan it now finds 7 of its 8 doors: the one from the Diele to the Zimmer below is drawn too faintly.

## Setup

```sh
./setup.sh            # service, room model and its CUDA ops (NVIDIA GPU, CUDA toolkit in /opt/cuda)
./setup.sh --no-model # service only: walls from the drawing, no room model check
```

`TORCH_INDEX` picks the PyTorch wheel index (default CUDA 13.0), `CUDA_HOME` the toolkit. The script is safe to run again. `npm run dev` starts the service when `.venv` exists. It listens on 127.0.0.1:8791 (`LOD2_FLOORPLAN_PORT`).

The room model is pinned to Raster2Seq commit `a6c4e27a`, cloned into `.raster2seq` with two small patches for current PyTorch. `RASTER2SEQ_DIR`, `RASTER2SEQ_PYTHON` and `RASTER2SEQ_CHECKPOINT` point elsewhere when needed.

## Licence

Raster2Seq's code is MIT. The checkpoint is trained on CubiCasa5K, whose licence (CC BY-NC 4.0) allows non-commercial use only. Fine for this demo, not for a product; a product needs a model trained on data it may use.

## Limits

- On a plan drawn out of proportion with the measured building, the outline is the best compromise, and walls can sit a few centimetres to a decimetre off.
- One storey per drawing, and the drawing must show the whole outline. A PDF with several storeys is split into pages in the editor.
- Curved walls are not found.

## Check

```sh
.venv/bin/python test_pipeline.py
```

A synthetic L-shaped plan with known walls, a door with jamb ticks, dimension lines and a staircase. It runs without the room model and without a GPU. With the room model installed, `.venv/bin/python test_samples.py` reads the BOo sample, the test plan and all four sheets of the BOo PDF end to end, the sheets against the walls and doors they were drawn from.
