# Write-up: photographs onto facades, and the openings in them

This is my answer to [CHALLENGE.md](CHALLENGE.md). The task was: pick a wall of a building in
the 3D view, give it a ground-level photograph, map the photo onto the wall plane, find the
windows and doors as geometry in metres, and report the opening area and the window-to-wall
ratio per wall.

The numbers I measured on the three sample photos are in [MEASUREMENTS.md](MEASUREMENTS.md).

## How to run it

You need Node 22.18 or newer and Docker. From the repo root:

```bash
nvm use
npm run setup           # installs the four packages
npm run bootstrap       # starts PostGIS, migrates, indexes Berlin, ingests the default area
npm run api             # terminal 1
npm run viewer          # terminal 2, then open http://localhost:5175
```

`npm test`, `npm run typecheck` and `npm run lint` run the checks for all packages. All three
pass. There are 121 tests in `lod2-core`, of which 54 are mine, and 14 each in `lod2-ingest`
and `lod2-api`, which I did not touch.

## What you should see

1. Paste a Gebäude-ID into the search box, for example `DEBE02YY40000BOo`. The building
   appears on the map and in 3D.
2. Click a wall in the 3D view. The right panel shows which surface you picked, a "Faces" row
   with its compass direction, for example "ESE (114°)", and an "Above ground" row with the
   wall's size in metres.
3. Press "Add photo". A big editor opens over the page. The button is only there when the
   selected surface is a wall.
4. Press "Choose photo" and pick the photo from `sample-photos/` that is named after the
   building. A line under the toolbar says whether the photo's compass direction matches the
   wall, or warns you that you may have picked the wrong wall.
5. Four numbered dots sit on the photo's corners. Drag them onto the four corners of the wall:
   top left, top right, bottom right, bottom left. A magnifier opens next to the dot while you
   drag. A small rectified preview on the right updates as you go, and the verticals in it
   become straight when the dots are right.
6. Press "Apply". The full rectified wall replaces the photo in the main area. It is a real
   image where 1 pixel is 1 cm of wall, so the image is 1433 by 1438 pixels for a wall that is
   14.33 m wide and 14.38 m high above ground.
7. Drag on the wall image to draw a box over a window or door. Each box shows its width and
   height in metres. "New", "Duplicate" and "Delete" and the X, Y, Width and Height fields
   edit the selected box. Under the image you see the number of openings, the total opening
   area, the wall area from the model, and the window-to-wall ratio.

Nothing is uploaded. The photo, the dots and the boxes live only in the browser and are gone
after a reload.

## The approach, step by step

**The person places the corners.** I decided against automatic corner finding. Dragging four
dots works on all three photos, a person can see the cars and the roof line, and a wrong dot
is easy to explain and easy to correct. The trade-off is that nothing is automatic.

**The wall is laid flat in metres.** `wallToPlane` in `lod2-core/src/wall.ts` takes the wall
ring from the model and gives a flat shape: u along the wall, v straight up, origin at the
bottom left, plus the width and height in metres. It uses the existing `newellNormal` and
`normalize` from `geometry.ts`. This is what makes the result metric. The rectified image is
shaped by the real wall, not by a guess.

**Four point pairs give a homography.** A flat wall seen by a camera is related to its photo
by a homography, a mapping with eight unknowns. Four wall corners and four photo dots give
eight equations, which `homographyFromPairs` in `lod2-core/src/homography.ts` solves by
elimination. I wrote this myself instead of adding a library. It is a small amount of maths,
there is no new dependency, and I can explain it line by line.

**The rectified image is built backwards.** For each output pixel, `rectifyImage` in
`lod2-core/src/rectify.ts` asks where it comes from in the photo and copies that colour. Going
backwards never leaves holes. The preview copies the nearest pixel, which is fast enough to
run on every mouse move. "Apply" blends the four nearest pixels, because at 1 cm per pixel
the photo is being stretched and nearest-pixel copying would look blocky.

**Openings are stored in wall metres.** A box is an `Opening` in `lod2-core/src/openings.ts`
with x, y, width and height in metres from the wall's bottom-left corner. The conversion from
image pixels to metres, the areas and the window-to-wall ratio live there too, with tests.

**The wall is measured above the ground, not from the model's floor slab.** This was the most
important finding. On kY the middle wall came out 26.22 m high, with 5 m floors and 3 m
windows, although the photo shows five floors and a parapet. The panel gave the cause: the
building is "up to 11.04 m deep" below ground. LoD2 models no basement, so the wall's bottom
edge in the model is 11 m under the street, and my bottom dots at the street were matched to
it. Everything was stretched by about 1.7. `wallGroundLevel` now takes the height of the
model's own terrain contact line along the wall, `clipRingAboveZ` cuts the wall there, and the
image, the height and the wall area for the ratio all follow. On kY the wall became 15.28 m
high above ground, with 10.94 m buried. BOo and Atr had 1.17 m and 0.97 m buried.

**Two checks against picking the wrong wall.** Atr has 12 walls and kY has 77. The panel now
shows which way a wall faces, using the existing `azimuthDeg`, so I can match the 113° and
289° the brief gives. The photo's Exif compass direction is read by a small reader in
`lod2-core/src/exif.ts`, which walks the JPEG to the GPS block and reads only
`GPSImgDirection` and its reference. The wall should face back at the camera, so the expected
facing is the camera direction plus 180. If the selected wall is more than 30° away, the
editor warns. The GPS coordinates are not read, because the brief says they are not accurate.

## What I tried that did not work

**Checking BOo and Atr against each other.** The brief points out that each building is in
the other's photo. I tried to measure BOo's wall in the Atr photo. Two of BOo's corners are
outside that image, the dots stop at the photo edge, and BOo is only a thin slanted strip. A
corner I cannot see is a guess, so I dropped this check rather than let dots leave the photo.

**A first preview that crashed the tab.** After the preview step, choosing the BOo photo killed
the page with nothing in the console. The photo is 4284 by 5712 pixels, about 98 MB of raw
pixels, and I was holding it three times, plus the magnifier asked the browser for a 2x
zoomed copy. Now the preview and the magnifier work from a copy at most 1600 pixels wide,
and "Apply" loads the full photo only while it runs.

**Trusting the model wall height.** Described above under "measured above the ground". Before
the fix, every height on all three buildings was too large, by 8 %, 6 % and 72 %.

## Where it is accurate, where it is not, and how I know

The full numbers are in MEASUREMENTS.md. In short:

- **Wall width and the wall area** come from the model and are exact for this purpose. On all
  six runs the model's polygon area equals width times height, so all three walls are plain
  rectangles.
- **Repeat drawing check.** I drew all openings twice on each wall with the same corners. The
  ground fix scales opening heights and the wall height by the same factor, so it cannot
  change the ratio. The difference between the two runs, 24.3 % against 22.6 % on BOo, 24.6 %
  against 23.7 % on Atr, 19.8 % against 18.1 % on kY, is therefore how repeatable the drawing
  is: about 1 to 2 percentage points.
- **Identical windows on one floor** differ by up to 16 cm in width and 16 cm in height on BOo,
  16 cm and 17 cm on Atr, and 12 cm and 17 cm on kY. That is the precision of a single box.
- **Doors are less reliable than windows.** The two BOo doors differed by 12 cm and 27 cm in
  width between the two runs, and by 5 cm and 19 cm in height after removing the stretch.
  Their bottoms are behind parked cars.
- **The BOo bottom corners are behind cars.** I placed them where the corners probably are. If
  they are a little off, the whole wall is stretched or squashed vertically.
- **The kY ratio of 18.1 % is too low.** A car and a hard shadow hide the ground floor, so no
  ground-floor openings were drawn, but the wall area includes the ground floor.
- **Ground-floor window bottoms** on BOo and Atr are behind cars and are estimates.
- **Facing direction trusts the ring's winding.** Berlin's data winds walls outward. A wall
  stored the other way would show the opposite direction and the compass check would warn
  wrongly.
- **Non-rectangular walls** are not handled exactly. The rectification uses the wall's outer
  rectangle. All three sample walls are rectangles, so this did not matter here.
- **True north against grid north.** The camera bearing is true north and the model azimuth is
  grid north. Berlin's meridian convergence is a couple of degrees, far inside the 30° warning
  threshold, so I did not correct it.

## Things I did not do on purpose

- **No automatic detection of windows.** The brief says a smaller thing I can explain beats a
  larger one I cannot. Every opening here was placed by a person and can be checked by a
  person.
- **No persistence.** A reload loses the photo, the dots and the boxes. The brief says a
  migration and a route are the price, and I judged it not worth the time box.
- **No fixes to the boilerplate.** A review of the existing code found real problems, for
  example that the closed-solid check in `lod2-core/src/geometry.ts` ignores which way a face
  points, so a cube with one face turned around still reports closed but with the wrong volume.
  Fixing their code was not the task. todo: list the other review findings here.

## What I would do next with more time

- Save the dots and the openings per wall, as the brief suggests: one migration, one route.
- Let the person mark an opening as "estimated" when it is behind a car or a skip, and report
  the ratio with and without those.
- Handle walls that are not rectangles, so a gable wall's top corners are not mapped to points
  that do not exist.
- Snap a dragged dot to a strong edge in the photo near the cursor, as a help rather than a
  replacement for the person.
- Use the same rectified image for a second, automatic pass over the openings, and compare it
  with the hand-drawn ones.

## Map of the files I added or changed

Everything is on top of the boilerplate commit `faa7a81`. Fifteen commits, listed by
`git log --oneline faa7a81..HEAD`.

Pure maths in `lod2-core`, each with a test file of the same name in `lod2-core/test/`:

| file | what it holds |
|---|---|
| `lod2-core/src/photo.ts` | fitting the photo into the screen, screen to photo pixel conversion, the magnifier maths |
| `lod2-core/src/wall.ts` | `wallToPlane`, `wallArea`, `wallAzimuth`, `wallGroundLevel`, `clipRingAboveZ`, `planeToWorld` |
| `lod2-core/src/homography.ts` | `homographyFromPairs`, `applyHomography`, `invertHomography`, the elimination solver |
| `lod2-core/src/rectify.ts` | `rectifyImage` with nearest and bilinear sampling, `previewSize`, `metricSize` |
| `lod2-core/src/openings.ts` | the `Opening` type, image to wall conversion, areas, ratio, move, duplicate, clamp, summary |
| `lod2-core/src/exif.ts` | the JPEG and TIFF walker that reads `GPSImgDirection`, plus `expectedWallFacing` and `angleDifference` |
| `lod2-core/src/index.ts`, `lod2-core/package.json` | exports for the six new modules |

The viewer:

| file | what changed |
|---|---|
| `lod2-viewer/src/ui/PhotoEditor.tsx` | new. The whole editor: photo stage with dots and magnifier, preview, Apply, wall stage with openings, toolbar, summary, compass note |
| `lod2-viewer/src/ui/InfoPanel.tsx` | the "Add photo" button, the "Faces" and "Above ground" rows |
| `lod2-viewer/src/state/store.ts` | `photoEditorOpen` with open and close actions |
| `lod2-viewer/src/App.tsx` | mounts the editor |
| `lod2-viewer/src/styles.css` | styles for the editor, dots, magnifier, openings and summary |

Documents: `MEASUREMENTS.md`, this file, and the link line in `README.md`.

The API and the ingest packages are unchanged.
