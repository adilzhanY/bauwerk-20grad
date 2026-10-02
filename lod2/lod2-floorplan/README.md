# lod2-floorplan

A local service that reads an old floor plan drawing into interior walls and doors. The editor calls it through its `/floorplan` proxy from the Underlay tab (**Read floor plan**), shows the result over the drawing, and applies it to the active storey as one undo step.

Nothing else in the project depends on it. Without it, the Underlay tab simply does not offer the import.

## What it does

The building's outline is already known from LoD2, to the centimetre. So the service does not have to guess the building. It has to find the drawing's scale and position, and then look for walls only inside that outline.

0. **Find the drawing on the sheet.** An architect's sheet (A3 with a title block, a legend and an area schedule round the plan) is cut down to the plan first: the cluster with the most wall-like ink, with a margin.
1. **Register.** The known footprint is matched onto the wall-like ink of the drawing (chamfer distance, a multi-start search over scale, rotation and shift). With the room model, only wall ink near its rooms counts: a drawing is rarely in exact proportion with the measured building, and a title line or a frame just outside the plan would otherwise pull the outline half a metre off. Among fits nearly as good as the best the largest wins (with the model, the largest that keeps its rooms inside), which stops the outline shrinking into a room. Over walls drawn filled, the fit is then grown to the outer face of the wall.
2. **Walls from the drawing.** Old plans draw a wall as two parallel lines 6 to 32 cm apart, or as one thick stroke. Those are found in the drawing. Ladders of parallel lines (stairs), single thin lines (dimensions) and anything along the outer wall are dropped. Pieces on one line are joined and their ends are carried to the outline or to the wall they meet.
3. **Checked against the room model.** Raster2Seq (trained on CubiCasa5K) predicts room polygons and doors. A wall is kept only when at least 60 percent of it lies on a predicted room boundary, and when it is held by the outline or another wall: at both ends, or at one end when it is at least 2 m long (a wall may end free at a passage). Pieces on one line up to 2 m apart are one wall with an opening. The model alone is too coarse to measure with (it works at 256 pixels), so it decides which walls are real and the drawing decides where they are.
4. **Room names.** Tesseract (`deu+eng`) reads the words on the plan; the ones inside the building go back with their place in plan metres, together with the room model's room types (kitchen, bath, bedroom...). The editor matches the words against its dictionary of German and English room names (`src/geometry/roomNames.ts`: old names, abbreviations like WZ or HWR, a letter or two misread) and names each room after the best words inside it, else after the room type. Without Tesseract the plan is read without names.
5. **Doors.** A door is where the ink across the wall drops: a gap between two wall pieces, or a spot the model marks as a door, refined along the wall by the amount of ink. Widths from 0.5 to 1.4 m.

`POST /walls` takes the plan image and the footprint in plan metres (a JSON list of `{x, y}`) and returns the walls and doors in the same metres, to the centimetre (each wall with its measured thickness, the gap between its two drawn faces), together with the fit error of the outline, the scale, the transform to image pixels, whether the room model took part, the words read inside the building (`labels`) and the room types (`roomKinds`). `GET /health` says whether the room model is installed.

On the ground floor plan of BOo (`lod2/sample-plans/`) it fits the outline to 1.7 cm at 49.9 px/m and finds 6 interior walls and 8 doors, which make the 8 rooms of the drawing in the editor. The entrance door comes out at 0.96 m; the plan writes 0.945. On `test_plans/haus-mueller-test.png`, drawn out of proportion with BOo's footprint and with a title line just above the outline, it finds 5 walls and 4 doors (it found nothing before the room-guided fit). On the sheets of `DEBE02YY40000BOo-Grundrisse.pdf` (four storeys, A3, made by `sample-plans/make_boo_plans.py`) it finds 5 to 7 walls and 6 to 10 doors per storey, and the editor names the rooms as the sheets do. Light partitions drawn as two thin lines with no room model boundary between them are often missed, so two rooms can come out as one.

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

- Plans with solid filled walls are less exact than plans drawn with two lines: the outline can sit anywhere across the filled wall, so interior walls can end a few centimetres off.
- One storey per drawing, and the drawing must show the whole outline. A PDF with several storeys is split into pages in the editor.
- Curved walls are not found.

## Check

```sh
.venv/bin/python test_pipeline.py
```

A synthetic L-shaped plan with known walls, a door with jamb ticks, dimension lines and a staircase. It runs without the room model and without a GPU. With the room model installed, `.venv/bin/python test_samples.py` reads the BOo sample, the test plan and a whole sheet of the BOo PDF end to end.
