# TODO: Aufmaß in 10 minutes

Goal: from a Berlin building in the lod2 viewer and a few facade photos, produce a pre-filled
Bauwerk building (footprint, storeys, roof, windows and doors per wall, shared walls, default
constructions for the age class), where every value records where it came from. The consultant
then only corrects it in Bauwerk.

Two repositories take part:

- `lod2-challenge` (this repo): the mapping maths in `lod2-core`, the survey state and the
  hand-off in `lod2-viewer`.
- `~/dev/bauwerk`: the editor that receives the building. It gains shared walls, value sources
  and an import from a link.

Rules: pure maths in `lod2-core` with `node:test` tests, simple code, no em or en dashes, run
typecheck, lint and tests after every block. Tick a box only when its check has run.

## 0. Facts that shape the design (checked)

- [x] Berlin LoD2 has no `yearOfConstruction` and no `storeysAboveGround`. It has
      `measuredHeight`, `roofType`, `function`, eave and ridge height per part.
- [x] A building can have many parts (kY has 11). Each part has its own mesh with ground, wall,
      roof and closure surfaces, and its own terrain contact line.
- [x] Bauwerk stores one footprint (outer wall face, counter-clockwise, metres) shared by all
      storeys. Openings sit on footprint edges by index, with offset from the edge start, width,
      height and sill above the storey floor.
- [x] Bauwerk's roof: flat, gable or hip. Hip only on an axis-aligned rectangle, cross gables only
      on rectilinear footprints. Plan +y has a compass bearing in `origin.rotation`.
- [x] Bauwerk has no shared-wall concept: every footprint edge loses heat to outside air.
- [x] Bauwerk's file: `{ format: "bauwerk", version: 1, building }`, checked by `validateBuilding`.

## 1. Test fixtures

- [x] 1.1 Save the building detail of BOo, Atr and kY as JSON fixtures in
      `lod2-core/fixtures/buildings/`.
- [x] 1.2 Save the neighbours of each sample building, trimmed to gid, origin and ground rings,
      so the shared-wall tests run without the API.
- [x] 1.3 Save the three detected opening sets (BOo street wall, Atr street wall, kY tall block)
      as fixtures in wall metres, with the wall key they belong to.
- [x] 1.4 A small fixture loader in the tests, typed through the lod2-core zod schemas.

## 2. Footprint from LoD2 (`lod2-core/src/footprint.ts`)

- [x] 2.1 `partFootprint(mesh)`: the ground surface ring projected to plan, closing vertex
      dropped, counter-clockwise.
- [x] 2.2 Remove duplicate vertices closer than 5 cm.
- [x] 2.3 Remove near-collinear vertices (turn below 3 degrees) and edges shorter than 25 cm,
      keeping the area within 1 percent. Test on all parts of the three fixtures.
- [x] 2.4 `dominantAxis(footprint)`: the angle of the longest edge, weighted by length, modulo 90.
- [x] 2.5 `alignToAxis(footprint, angle)`: rotate so the dominant axis is plan x. The bearing of
      plan +y becomes Bauwerk's `origin.rotation`. Test: BOo's street edge becomes horizontal.
- [x] 2.6 `squareCorners(footprint, toleranceDeg)`: optional squaring of corners within 5 degrees
      of 90, keeping the area within 2 percent. Off by default; recorded as its own source.
- [x] 2.7 Check `isSimplePolygon` after every step; fall back to the unsimplified ring if a step
      breaks it.

## 3. Heights and storeys (`lod2-core/src/storeys.ts`)

- [x] 3.1 Street level of the part: mean of the contact line (existing `wallGroundLevel` logic,
      applied to the whole footprint).
- [x] 3.2 Eave height above street: part eave height minus the buried depth.
- [x] 3.3 `estimateStoreys(eaveAboveStreet)`: round to storeys of about 3.1 m (old stock) or
      2.8 m (after 1949), at least 1. Test: BOo gives 5 at 2.9 to 3.3 m each.
- [x] 3.4 `storeyHeights(eave, count)`: equal heights that sum to the eave height.
- [x] 3.5 A storey count typed by the user replaces the estimate, and the source says so.

## 3b. Storeys from the photo

- [x] 3b.1 Rows of openings with overlapping heights; basement grilles left out.
- [x] 3b.2 Floors halfway between rows, ground floor at the street, top storey to the eave.
- [x] 3b.3 Typed count wins over the photo, warning when they disagree; estimate when no photo.
- [x] 3b.4 Warning for storeys above 4.2 m (a row of windows probably not seen).

## 4. Roof (`lod2-core/src/roofmap.ts`)

- [x] 4.1 Map AdV roof codes to Bauwerk kinds: 1000 flat, 2100 mono pitch as flat with a note,
      3100 gable, 3200 and 3300 hip, 3400 mansard as gable, 5000 mixed from the roof planes.
- [x] 4.2 Pitch from ridge minus eave over half the depth across the ridge. Clamp to 0..60.
- [x] 4.3 Ridge axis: plan x or y after alignment, along the longer side.
- [x] 4.4 Hip on a non-rectangle degrades to gable, with a note. (Bauwerk builds a gable on any
      footprint by splitting it along the ridge, so gables stay gables.)
- [x] 4.5 Tests: BOo mixed roof, kY hip part, a flat part.

## 5. Openings onto footprint edges (`lod2-core/src/placeopenings.ts`)

- [x] 5.1 `wallBaseSegment(wallRing, groundZ)`: the plan segment where a LoD2 wall meets the
      street.
- [x] 5.2 `matchEdge(segment, footprint)`: the footprint edge that is parallel (within 8 degrees)
      and closest (within 60 cm), with the largest overlap. Null when none.
- [x] 5.3 `toEdgeOffsets(opening, wallRing, groundZ, edge)`: the opening's left and right ends
      through `planeToWorld`, projected onto the edge; offset is the smaller, width the
      difference.
- [x] 5.4 Split by storey: the opening's bottom above street picks the storey; sill is the height
      above that storey's floor. An opening crossing a storey floor is clipped to the storey it
      mostly sits in, with a note.
- [x] 5.5 Doors: sill forced to 0 (Bauwerk rule) when the bottom is within 30 cm of the floor,
      otherwise the door becomes a window with a note (a shop door on a raised ground floor).
- [x] 5.6 Resolve overlaps on one edge and storey: keep the higher score, shrink or drop the
      other, note it.
- [x] 5.7 Clamp every opening inside its edge and storey; drop openings under 20 cm.
- [x] 5.8 Tests with the fixture openings: BOo keeps 24 to 25 openings, total area within
      1 percent of the lod2 result, every opening passes Bauwerk's rules.

## 6. Shared walls (`lod2-core/src/sharedwalls.ts`)

- [x] 6.1 Neighbour footprints in the same plan frame (origins differ per mesh).
- [x] 6.2 `sharedEdges(footprint, neighbours)`: edges whose line lies within 30 cm of a neighbour
      edge, anti-parallel, overlapping at least half their length. Return the overlap fraction.
- [x] 6.3 Tests: BOo and Atr share one wall; a free-standing part shares none.
- [x] 6.4 Openings on a shared edge are dropped with a note (they cannot exist there).

## 7. Age class and constructions (`lod2-core/src/ageclass.ts`)

- [x] 7.1 Age classes and default U-values from the Bekanntmachung of 8 October 2020 (BAnz AT
      04.12.2020 B1), table of flat-rate values, with the source in a comment.
- [x] 7.2 `constructionsFor(ageClass)`: Bauwerk constructions for wall, roof, floor, window and
      door with those U-values, names in German and English, stable ids.
- [x] 7.3 Default class when unknown: "bis 1918" for Berlin residential buildings, flagged as a
      guess.
- [x] 7.4 Tests: every class yields five constructions with positive U-values.

## 8. The Bauwerk file (`lod2-core/src/bauwerk.ts`)

- [x] 8.1 A local copy of the Bauwerk types this repo writes (no dependency on Bauwerk).
- [x] 8.2 `toBauwerk(input)`: part, facts (age class, storeys), openings per wall, neighbours ->
      `{ format: "bauwerk", version: 1, building }`.
- [x] 8.3 One heated zone, no rooms (Bauwerk then counts every storey as heated).
- [x] 8.4 `origin`: lat and lon of the plan origin from UTM 33 (inverse transverse Mercator, tested
      against a known point to 1 m), rotation from the alignment.
- [x] 8.5 `sources`: a map from value path to `{ kind: "lod2" | "photo" | "catalogue" |
      "estimate" | "typed", note?, photo? }`.
- [x] 8.6 Stable ids so a second export of the same building gives the same ids.
- [x] 8.7 Tests: all three fixtures produce a file, footprint counter-clockwise and simple, every
      opening inside its wall, every id unique.
- [x] 8.8 Cross-check script `scripts/check-bauwerk.mjs`: runs Bauwerk's own `fromJson` and
      `computeEnergy` on the generated files and prints class, heating demand and window share.

## 9. Bauwerk changes (`~/dev/bauwerk`)

- [x] 9.1 `Building.sharedEdges?: number[]`: footprint edges against a heated neighbour.
- [x] 9.2 Energy: shared edges lose no heat (F = 0 against a heated neighbour); their area is
      listed separately so the report can show it. Tests.
- [x] 9.3 Validation and JSON shape check accept `sharedEdges` and `sources`.
- [x] 9.4 3D view: shared walls drawn in a muted hatch colour so they read as party walls.
- [x] 9.5 `Building.sources?`: each source stores the value it came with; the editor compares it
      with the current value, so an edit shows as "edited" without hooks in every action.
- [x] 9.6 A "Source" row in the properties of the selected wall, opening, storey and roof.
- [x] 9.7 Report page "Where the values come from": a table of every value with its source.
- [x] 9.8 Import from a link: `#import=<base64url JSON>` loads the file after a confirm, then clears
      the hash.
- [x] 9.9 Bauwerk check suite green (`npm run check`): 377 tests.
- [x] 9.10 Fixed on the way: splitting a footprint edge left openings and radiators on the old
      edge numbers; they now move with the split (`placeAfterSplit`), and radiators follow a
      removed vertex like openings do.

## 10. Survey state in the viewer (`lod2-viewer`)

- [x] 10.1 Store slice `survey`: per building gid, per wall key the openings in wall metres, the
      photo file name, the time, and whether they came from the detector or by hand.
- [x] 10.2 The photo editor writes the current openings into the survey on every change, only
      once a straightened wall exists, so opening and closing the editor never wipes a survey.
- [x] 10.2b Openings keep window or door through clamping and edits; a Window/Door switch in the
      toolbar.
- [x] 10.3 Persist the survey in localStorage per building; survive a reload.
- [x] 10.4 Panel section "Survey": walls done, openings count, opening area, and a clear button.
- [x] 10.5 Facts in the panel section (no dialog needed): construction year class, storeys from
      the photo or typed.
- [x] 10.6 "Send to Bauwerk": builds the file with `toBauwerk`, opens Bauwerk at
      `VITE_BAUWERK_URL#import=...`, and also offers "Download .bauwerk.json".
- [x] 10.7 3D view: walls with a survey get a small tick in the caption.

## 11. End-to-end checks

- [x] 11.1 BOo: detect openings on the street wall, send to Bauwerk, energy class and heating
      demand printed by the check script; compare with the Bauwerk demo house of similar age.
- [x] 11.2 Atr: same, and confirm the shared wall with BOo is marked on both.
- [x] 11.3 kY: multi-part building, one part exported, warning about the others.
- [x] 11.4 Edited values show as edited (Bauwerk `sources.test.ts`); the check script confirms that
      nothing arrives marked edited. A click-through in the browser is still to do by hand.

## 12. Documentation

- [x] 12.1 README section "Send a building to Bauwerk" with the workflow and its limits.
- [x] 12.2 Bauwerk README: import from lod2, shared walls, sources.
- [x] 12.3 Known limits: roof simplification, back facades without photos, multi-part buildings,
      age class from the user.

## Later

- [ ] Default window share for facades without a photo, from the age class, marked "catalogue".
- [ ] Construction year from Berlin's Umweltatlas building age map, if it is per building.
- [ ] Multi-part buildings as one Bauwerk building (needs storey-specific footprints in Bauwerk).
- [ ] Export to IFC plus the din18599-ifc sidecar for Hottgenroth and ZUB.
- [ ] Terrain slope for the bottom dots in the photo editor.
