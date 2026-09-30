# lod2-floorplan

A local service that reads an old floor plan drawing into interior walls and doors. The editor calls it through its `/floorplan` proxy from the Underlay tab (**Read floor plan**), shows the result over the drawing, and applies it to the active storey as one undo step.

Nothing else in the project depends on it. Without it, the Underlay tab simply does not offer the import.

## What it does

The building's outline is already known from LoD2, to the centimetre. So the service does not have to guess the building. It has to find the drawing's scale and position, and then look for walls only inside that outline.

1. **Register.** The known footprint is matched onto the wall-like ink of the drawing (chamfer distance, a multi-start search over scale, rotation and shift). Among fits that are nearly as good as the best, the largest scale wins, which stops the outline shrinking into a room.
2. **Walls from the drawing.** Old plans draw a wall as two parallel lines 6 to 32 cm apart, or as one thick stroke. Those are found in the drawing. Ladders of parallel lines (stairs), single thin lines (dimensions) and anything along the outer wall are dropped. Pieces on one line are joined and their ends are carried to the outline or to the wall they meet.
3. **Checked against the room model.** Raster2Seq (trained on CubiCasa5K) predicts room polygons and doors. A wall is kept only when at least 60 percent of it lies on a predicted room boundary, and only when both its ends meet the outline or another wall. The model alone is too coarse to measure with (it works at 256 pixels), so it decides which walls are real and the drawing decides where they are.
4. **Doors.** A door is where the ink across the wall drops: a gap between two wall pieces, or a spot the model marks as a door, refined along the wall by the amount of ink. Widths from 0.5 to 1.4 m.

`POST /walls` takes the plan image and the footprint in plan metres (a JSON list of `{x, y}`) and returns the walls and doors in the same metres, to the centimetre (each wall with its measured thickness, the gap between its two drawn faces), together with the fit error of the outline, the scale, the transform to image pixels and whether the room model took part. `GET /health` says whether the room model is installed.

On the ground floor plan of BOo (`lod2/sample-plans/`) it fits the outline to 1.2 cm at 49.9 px/m and finds 6 interior walls and 8 doors, which make the 8 rooms of the drawing in the editor. The entrance door comes out at 0.96 m; the plan writes 0.945.

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
- One storey per drawing, and the drawing must show the whole outline.
- Curved walls are not found.

## Check

```sh
.venv/bin/python test_pipeline.py
```

A synthetic L-shaped plan with known walls, a door with jamb ticks, dimension lines and a staircase. It runs without the room model and without a GPU.
