# Decisions

The review log. Every entry is a place where the human overruled, corrected, rejected or deliberately constrained what the agent produced, or made a design call the agent could not make alone. This file is shown at the interview, so write it for a reader who was not there.

Format for each entry:

```
## YYYY-MM-DD  Short title

What the agent did or proposed.
Why it was wrong, risky, or not the call to make automatically.
What was done instead, and how it was verified.
```

## 2026-09-05 Scope cut before the first line of code

The posting lists windows and openings, rooms, zones, HVAC, multi-storey support and richer editing tools. HVAC, roofs, real IFC export, textures and collaboration were cut on purpose. Two days are available and a finished small editor with tests is worth more in the call than a broad unfinished one. The cut list is written in `INFO.md` so it can be said out loud rather than discovered.

## 2026-09-05 Geometry is pure and Three.js free

Decided before generation: everything under `src/geometry/` is plain TypeScript over numbers and arrays, with no Three.js import, so it can be unit tested in Vitest without a WebGL context and so the correctness argument does not depend on rendering. The scene layer only converts geometry output into meshes. The agent is not allowed to relax this, see `CLAUDE.md`.

## 2026-09-05 Scaffold template rejected, versions pinned by hand

`npm create vite@latest` now produces React 19, Vite 8, TypeScript 6 and oxlint, which contradicts the fixed stack in `INFO.md` (Vite 6, React 18, TypeScript 5, ESLint). The generated template was discarded and `package.json` was written by hand with the pinned majors. This also forced `@react-three/fiber` 8 and `@react-three/drei` 9, since fiber 9 and drei 10 require React 19. `npm install` needed `--legacy-peer-deps` because npm 10 crashes resolving Vitest 4's optional peers. Verified with `npm run check` and a production build under `VITE_BASE_PATH=/bauwerk/`, fonts bundled locally, no external requests.

## 2026-09-05 Footprint is the outer face, interior walls have no thickness

Two calls the agent could not make alone. First: the footprint polygon is the outer face of the exterior walls and the inner face is offset inward by the wall thickness, mitred at corners. Opening offsets measure along the outer edge. The alternative, footprint as wall centreline, would make the visible outline and the drawn polygon disagree. Second: interior walls are zero-thickness lines for room extraction, so room areas sum exactly to the footprint area, which is the invariant the tests enforce. A thick interior wall would eat floor area and the sum rule would no longer hold. Verified in `walls.test.ts` (ring area equals outer minus inner rectangle) and `rooms.test.ts` (areas sum within 1e-4).

## 2026-09-05 Room identity survives recomputation by centroid, not by index

Rooms are derived from interior walls, but the user names them and assigns zones. When a wall is added the agent's first idea was to match old rooms to new ones by array index, which reshuffles names as soon as face order changes. Replaced with centroid matching: a previous room keeps its id, name and zone in whichever new face contains its old centroid, largest rooms first. Splitting a room keeps the identity in the half that holds the centroid; merging keeps the larger room. Tested in `rooms.test.ts` and `building.test.ts`.

## 2026-09-05 Openings cut walls by splitting into prisms, not by CSG

`INFO.md` left the choice open between `three-bvh-csg` and manual subtraction. Chosen: no CSG at all. A wall is split along its length into columns at every opening edge; a column with an opening becomes a prism below the sill and a prism above the head, the other columns are full height. Each prism is a plan quad following the mitred inner face, extruded vertically, and the prisms of one wall are merged into a single mesh. This is a pure function (`wallSolids` in `src/geometry/walls.ts`) whose volume is unit tested: full wall volume minus cut volume equals the sum of the opening areas times the thickness. CSG would have added a dependency, been untestable without WebGL, and produced dirty topology at shared edges. The cost is that openings are always rectangular, which the spec already requires.

## 2026-09-05 Number inputs commit on blur, sliders on release

The first draft of the properties panel wrote to the store on every keystroke and every slider tick. That works, but it makes undo useless: typing "2.4" left three history entries and dragging a slider left dozens. Changed so text inputs commit on blur or Enter and sliders commit on pointer release, with a local draft in between. One edit is one undo step. Inputs also accept both comma and dot, since the German locale writes 0,3 and the exported JSON must still write 0.3. Verified in `App.test.tsx` (comma input commits 0.4) and by the store tests that count history entries.

## 2026-09-05 Energy numbers are simplified and say so

The building physics layer computes transmission loss as a plain sum of U times A over the heated envelope, ventilation loss with a fixed 0.5 air changes, and heating demand from 84 kKh Berlin degree hours. It ignores solar and internal gains, thermal bridges and the ground reduction factor, and treats rooms without a zone as heated. A DIN V 18599 calculation was not attempted: it would take longer than the demo allows and the point of the layer is that every number on screen can be traced to a formula in a comment and a hand-computed test. The assumptions are printed at the bottom of the Energy panel so nobody mistakes the result for a certificate. `energy.test.ts` checks the default building against numbers computed by hand: 335.2 W/K uninsulated, 71 W/K renovated.

## 2026-09-05 IFC LongName written as a typed value, caught by an independent validator

The first IFC export wrote the IfcSpace LongName as `IFCLABEL('Küche')`. The agent's own tests passed, because they only checked structure and references. Running the file through IfcOpenShell's schema validator reported five errors: LongName is declared as IfcLabel, so the value must be a plain string; the typed wrapper form is only for SELECT attributes. Fixed, a regression test now forbids `IFCLABEL(` in the output, and the validator run is kept as `scripts/validate-ifc.py` so the export is checked against something the agent did not write. Lesson recorded for the interview: a self-written parser agreeing with a self-written writer proves little.

## 2026-09-05 Plain pg over an ORM, and last write wins over a CRDT

Two calls for the server. Storage: plain `pg` with one SQL migration file instead of Prisma or TypeORM. The schema is two tables and the one query that matters, `UPDATE ... WHERE id = $1 AND version = $2`, is exactly the kind of statement an ORM hides. Concurrency: optimistic version numbers with last write wins instead of a CRDT. Two people dragging the same window at once is not the demo's problem; two people editing the same project and never losing a whole session is. Every accepted write is one row in `project_events`, so the history is replayable. A CRDT would need a per-element merge policy for a data model that derives rooms from walls, which is a research task, not a weekend one. The client documents the choice in `src/sync/client.ts` and tests the 409 path.

## 2026-09-05 Connection pool deadlock in the conflict path, caught by the concurrency test

The first version of `ProjectsService.update` held its pooled client through the transaction and, when the version check failed, called `this.get(id)`, which asked the pool for a second connection. The test with twelve simultaneous writers on a ten-connection pool hung until it timed out: every client was held by a writer waiting for a connection that no writer would release. Fixed by reading the current row on the same client after the rollback. The test that found it is the one `TODO.md` asked for: concurrent writes against a real Postgres, not a mock. A mocked pool would have passed.

## 2026-09-05 A remembered UTM reference value was wrong, and three series terms were not enough

The agent wrote the UTM test against a value it remembered from the Wikipedia worked example for the Eiffel Tower. The test failed by 2.4 m. Instead of loosening the tolerance, the coordinates were run through pyproj (PROJ, EPSG:32631 and EPSG:25833) in a scratch environment: the agent's forward projection agreed with PROJ to 0.1 mm at every point and the remembered reference was the thing that was wrong. The test now carries PROJ's numbers and names their source. The same run showed a constant 0.7 mm bias in the inverse direction, which is the size of the missing fourth-order Krüger term; the coefficients were extended and the round trip is now under 0.1 mm. Two lessons for the interview: a reference value in a test must have a source, and an independent implementation is the cheapest way to find out which side of a disagreement is wrong.

## 2026-09-05 Photo underlay stays out of the model

The floor plan underlay (an image on the ground for tracing) is UI state in the browser only: an object URL, a width in metres, a position and an opacity. It is not part of the building, not autosaved, not exported and not synced. The alternative, embedding the image as base64 in the JSON, would have bloated every export and every WebSocket broadcast with megabytes that have nothing to do with the model. Scaling works through the measure tool: measure a known distance on the image, type the real length, apply. No image processing, no dependency.

## 2026-09-05 Live updates while dragging, overruling commit-on-release

Earlier the agent made number inputs and sliders commit only on release or blur, to keep one undo step per edit. Adilzhan rejected that: when changing a height, width or thickness the model has to follow the hand, not jump when the mouse is let go. The fix keeps both properties. Sliders and inputs write to the store on every tick and every valid keystroke, and the history middleware gained a batch mode: `beginBatch` on pointer down or focus, `endBatch` on release or blur, and only the first change inside a batch records the snapshot. A drag of twenty ticks is still one undo step, tested in `building.test.ts` and `App.test.tsx`. The sync client already coalesces writes, so a drag produces one request in flight at a time, not twenty.

## 2026-09-05 Interface redrawn, native controls banned

Adilzhan rejected the first interface: dark chrome, blue accent, Inter, native selects and range inputs, the look every generated tool has this year. The redesign is light by default with a designed dark option, a paper ground with ink text, red only for marks and warnings, blue only for selection, Archivo, IBM Plex Sans and IBM Plex Mono bundled locally. Every form control is now our own component in `src/components/`, each with the ARIA role of what it replaces and a test that drives it by keyboard and pointer: slider with pointer capture and value bubble, number input with label scrubbing, select as combobox and listbox with type-ahead, switch, segmented control, swatches, tabs, dialog with focus trap. An App test greps the rendered tree for `select`, `input[type=range]`, `input[type=checkbox]` and `input[type=number]` and fails if any appear. The 3D scene reads its ground, grid and background from the same tokens, so it follows the theme. Verified with 206 tests; the visual pass in both themes is Adilzhan's.

## 2026-09-05 Second interface pass from Adilzhan's review

Eight corrections after looking at the redesign: everything fully rounded, no mono font for numbers, the tool rail floating at the bottom centre like Figma, side panels floating with rounded corners, bigger controls and type, no uppercase anywhere, the left panel organised by an icon strip so one section shows at a time, and a custom cursor set with every state. Two calls made under that direction. The number face is Manrope, a geometric sans with tabular figures, so digits still line up without a typewriter look; the agent had argued for mono and was overruled. The cursors are drawn as SVG in the repository instead of downloaded: a found cursor pack carries licence and attribution questions a portfolio does not need, and drawing eight 24 px shapes is an hour, not a risk. Hotspots and SVG validity are tested; the canvas cursor follows the active tool through a `data-tool` attribute. Visual judgement of the result stays with Adilzhan.

## 2026-09-05 The print view is a document, not a screen

Adilzhan: when printed it must look like a German building document, not like the interface. The print view now drops every design token: Arial, black hairlines, grey field labels over white value boxes in numbered sections, a plain table for the indicators, the A+ to H scale with kWh/(m²·a) ticks and two markers, one A4 page per storey with plan and room table, and a method page. The visual language comes from the official Energieausweis and iSFP documents (gebaeudeforum.de, GEG-Infoportal), but the form itself is not imitated and the first paragraph says it is not a certificate under the GEG. Numbers, dates and times use German conventions regardless of the interface language: 1.234,5 and 05.09.2026, 18:04. A test renders the page with a fixed clock and checks the time format and that no rounded or shadow class survives.

## 2026-09-05 A location must be visible, so the ground shows the map

Adilzhan set a location and saw nothing but grey ground, and asked whether he should see a map. He should. The location had only fed exports, orientations and a compass, which is correct and invisible. The ground now shows OpenStreetMap raster tiles around the origin at true scale, rotated with the plan, with the attribution the tile policy requires. OpenStreetMap over Google Maps: no key, no billing, and the right look for a planning tool. This is the first runtime request to an external server; INFO.md records it as the one exception to the no-external-requests rule. Two geometry facts surfaced by the tests and kept in comments: Mercator tiles are square on the sphere but not on the ellipsoid (0.3 percent), and tile edges follow geographic north while the plan follows UTM grid north, which in Berlin differ by about 1.3 degrees.

## 2026-09-05 Layers compute the U-value, and the layers set the wall thickness

Constructions for walls, roofs and floors are now layer stacks with thickness and conductivity, U = 1 / (R_si + Σ d/λ + R_se) after DIN EN ISO 6946 with the standard surface resistances. Two consequences the agent had to be told to accept. First, the preset U-values moved: the brick wall is 1.48 from its layers, not the typed 1.4, so the hand-computed energy tests now read the preset values and check the formulas rather than fixed numbers. Second, the exterior wall thickness follows the wall construction's layer stack and the typed thickness is only the fallback, because a 42 cm insulated wall drawn 30 cm thick would be a lie in the plan. Windows and doors stay typed products. IFC export carries the stack as IfcMaterialLayerSet with a usage per wall and the conductivity in Pset_MaterialThermal; IfcOpenShell still reports zero issues.

## 2026-09-05 Thermal bridges as geometry, two psi sets, in the total

Bridges come from lengths the model already has: corners, opening perimeters, slab and roof edges, floor joints, interior wall junctions. The agent proposed a single blanket allowance of 0.05 W/(m²K) on the envelope, which is what certificates do when no detail is designed. Rejected for the demo: a blanket number teaches nothing and cannot be drawn. Instead every bridge has a type and a length, two ψ sets exist (good after DIN 4108 Beiblatt 2, poor for the uninsulated stock), the renovated scenario assumes good detailing, and the lines are drawn in red on the model with the W/K on hover. The bridge term is included in H_T rather than reported beside it, so the class on the scale already contains it. The hand-computed energy tests subtract the bridge term explicitly so the U·A formulas stay checked.

## 2026-09-05 Hip roofs only on rectangles, gables as folded plates everywhere

A general hip roof needs the straight skeleton of the footprint, a proper computational geometry algorithm with its own failure modes on concave shapes. Not worth it for the demo: hip roofs are built for axis-aligned rectangular footprints (two trapezoids, two triangles, the ridge shortened by the half span at each end) and every other footprint falls back to a gable, with the fallback shown in the properties panel. Gables work on any footprint as a folded plate over the ridge line. Roof area is the true sloped area and feeds the heat loss; attic volume is exact because each face is planar, so it is plan area times the height at the plan centroid. The roof goes into IFC as an IfcRoof with one ROOF slab member per face as a surface model; IfcOpenShell builds all 39 solids of the gable example with zero schema issues.

## 2026-09-05 Classical vision first, a model only if scans defeat it

The footprint-from-photo pipeline is classical: adaptive threshold, closing, a projection-profile deskew, axis-aligned run scanning for wall lines, collinear merging, corner snapping, then the planar face extraction the room engine already had, now shared. The agent's first skew estimator voted per pixel on quantised slopes and returned zero on thick lines; replaced with the projection-profile search used for document deskew, which recovers a two degree skew within half a degree on the synthetic plans. No neural model yet: a segmentation network in the browser is the stretch item, kept for the day a real scan defeats the classical path, and that day gets its own entry here. The image scale comes from the underlay calibration with the measure tool, so metres are the user's responsibility, not a guess from paper size. Accepting a proposal replaces the footprint and the active storey's interior walls in one undo step.

## 2026-09-05 Heating sized from the rooms, not typed by hand

Radiators, a heat pump and pipe runs are the last element type from the posting. The agent first placed radiators with a fixed 1000 W. Changed so the placement reads the room behind the wall, computes its heat load after a simplified DIN EN 12831 (U·A of the room's own envelope share plus ventilation plus its share of the thermal bridges, times 32 K for Berlin's design temperature), and sizes the radiator to that load rounded up to 100 W; the heat pump suggestion is the building load with a 1.1 safety factor. A radiator may sit under a window but not across a door, and never overlaps another radiator; import enforces the same. IFC gets IfcSpaceHeater with OutputCapacity, IfcUnitaryEquipment with NominalHeatingCapacity and IfcPipeSegment per leg. The per-room loads are checked against the building total in the tests, so the split cannot silently lose a wall.

## 2026-09-05 A real sun, and gains that are honest about their source

The sun follows the NOAA position algorithm, tested against the Berlin solstices: noon elevation within 0.4 degrees, sunrise and sunset within four minutes of the almanac, and the German CET/CEST switch dates. Solar gains use the simple DIN V 4108-6 method with heating-period irradiation values per orientation that are approximations for the German reference climate, marked as such in the code; the agent was not allowed to present remembered monthly tables as standard values after the UTM episode. Gains are subtracted from the heating demand with a 0.95 utilisation factor and can never push the demand below zero. The sun light replaces most of the fixed studio light when it is on, so shadows on the facade are real for the chosen day and time.

## 2026-09-05 IFC import reduces to the editor's model and says what it dropped

Reading IFC back is mostly deciding what to do with geometry the editor cannot hold. Rules chosen: the footprint is the outer boundary of the union of exterior wall quads on the lowest storey (the agent first took the largest bounded face, which is the building's inside; caught by the round trip test, fixed with an outer boundary chain); interior walls become centre lines, and because other tools stop partitions at the inner face of the exterior wall while our footprint is the outer face, ends within one wall thickness of the boundary are pushed onto it, or rooms would never split; rooms are recomputed and IfcSpace names attach by centroid; curved walls, sloped extrusions, curtain walls and non rectangular openings are listed in a report the user sees before loading. Rectangle profiles with placements, the form other authoring tools write, are supported alongside polylines, and a hand written foreign style sample in `docs/` is part of the tests. Wall thickness on import is the median offset of the quads, which for our own files is the layer stack thickness, not the typed fallback.

## 2026-09-05 Scenarios are overrides, and the costs say what they are

Renovation variants are stored as override sets on the current state (which construction per category, the bridge detailing, optionally the roof), so a change to the baseline flows into every variant, and the old before-and-after switch became the built-in "full envelope" variant. Costs and payback needed a source the agent could not honestly cite for every preset, so the €/m² values are labelled as rough 2025 gross prices in the range of the public cost indices and the panel and the print roadmap both say to replace them with quotes before a customer sees them. The roadmap page sorts variants by payback, which is how the iSFP presents measure packages. The IFC export carries each variant's demand, class and investment in a property set on the building, and the regression test that once forbade `IFCLABEL(` everywhere now forbids it only on entity attributes, because property values are SELECT types and require the wrapper.

## 2026-09-05 Section cut without caps, walkthrough with a testable collision rule

The section cut is one global clipping plane on the renderer; cut faces read as solid because the wall meshes are already double sided. Drawing coloured cap faces would need stencil passes for a screenshot effect, so it was left out and written down. The walkthrough camera stands at 1.6 m on the active storey with pointer lock and WASD; its collision rule lives in a pure function that keeps the walker inside the inner wall face, slides along walls, passes through door spans and keeps a body radius from interior walls, all tested without a camera. Stairs are not modelled, so PageUp and PageDown teleport between storeys, which the hint says.

## 2026-09-05 The PDF is the client's own print page, printed by Chromium

Two attempts before the right one. First the server installed its own React to render the print view to HTML; hooks crashed because the client code resolved React from the repository root, two copies. Then, with one React, the PDF showed the default building: on the server React reads Zustand's server snapshot, which is the store's initial state, and that snapshot lives in a closure nothing outside can change. The final design drops server-side React altogether: the NestJS server serves the built client from `dist/`, headless Chromium opens `/?print=1` with the building placed in localStorage where the app autosaves, and prints. The PDF is therefore exactly the page a user's browser prints, one document, no second template. The endpoint validates the building first and answers 422 with the geometry error, 503 when no client build is served; the test reads the PDF back with pdf-parse and finds the building name on the first page. CI builds the client before the server tests.

## 2026-09-05 The benchmark measures, it does not promise

The performance page loads a fifty storey tower with a thousand openings and shows frame times over the last ten seconds with the renderer's own draw call and triangle counters. Instancing interior walls and merging room fills, the two optimisations the task listed, were not done in advance: the rule is to optimise after the number, not before it, and the agent cannot read that number without a GPU. The README states where the numbers go and who records them. What is in place is the strategy the page describes: one merged mesh per wall memoised by input hash, per element memoisation of fills and labels, throttled hover, no raycasting on inactive storeys.

## 2026-09-05 Blank page from a selector that allocated, caught by Adilzhan, not by the tests

The app opened to an empty page. Nothing in the test suite noticed, because jsdom has no WebGL and the whole `src/scene/` tree is replaced by the WebGL-missing state in tests. The cause was one Zustand selector in the heat pump component: `s.building.heatPumps ?? []` returns a new array on every read when there are no heat pumps, so useSyncExternalStore saw a changed snapshot after each render and React stopped the loop with "Maximum update depth exceeded". Fixed by selecting the stored value and applying the fallback outside the selector. Two consequences kept: an error boundary now prints a crash on the page with its stack, so the next blank page is a report instead of a mystery, and the scene remains a blind spot of the automated tests that the human check has to cover, which this entry records.

## 2026-09-05 Interaction died after a storey switch: `raycast={undefined}`

Adilzhan found the sequence: openings work, switch storey, nothing works anywhere, not even hover, until reload. Rooms and interior walls switched their raycast off on inactive storeys with `raycast={active ? undefined : noRaycast}`. When a storey became active the prop turned into `undefined`, react-three-fiber wrote that onto the mesh, and the next pointer event called a raycast that no longer existed. The exception inside the raycaster stopped event handling for the whole scene. The fix passes the real `Mesh.prototype.raycast` instead of `undefined`. The earlier "fix" for the same report, letting walls on inactive storeys be clicked, was a good change for a different reason; the real cause was only found because the human reproduced it as a sequence, which the scene tests cannot do.

## 2026-09-05 Cross gable for L shapes, spotted by Adilzhan in the viewport

The gable over a non rectangular footprint was a folded plate: one ridge through the bounding box, every point lifted by its distance to that ridge. On an L shape the narrow wing then floated above its own wall, which Adilzhan saw at once and diagnosed correctly: split the rectangles. The roof now decomposes a rectilinear footprint into maximal rectangles along the ridge axis and builds one gable per rectangle, each with its own ridge, so every eave meets its wall and the print plan shows every ridge. The roof planes of the wings intersect at a valley; the small overlap there slightly overstates the roof area, which the code notes. Non rectilinear footprints keep the folded plate.

## 2026-09-05: Inactive storeys hid the floor being edited

With two or more storeys and a lower one active, the agent's fixed 25 % opacity for other storeys still covered rooms and windows. The user rejected the single constant and proposed a slider, hiding, or outlines. A web check of how Revit (halftone underlay), ArchiCAD (ghost story) and SketchUp (X-ray) handle it led to separate settings for storeys above and below the active one, with hidden / outline / ghost / solid modes and a ghost opacity slider. Default above is outline, default below is ghost at 15 %.

## 2026-09-05: Walkthrough crashed the camera effect

Starting the walkthrough replaced the orbit controls with pointer lock controls, and the agent's camera fitting effect read the orbit target off them and crashed the whole app. Found by the user on the first click. The effect now ignores any default controls without an orbit target.

## 2026-09-05: The map was still invisible after three fixes

The user reported for the fourth time that the OpenStreetMap ground was not showing. The earlier agent fixes changed depth writing and the ground material, based on reasoning rather than evidence. This time the tile was downloaded with curl and the quad normal computed from the real corner numbers: it pointed down, so the single-sided material culled every tile from above. The winding is now derived from the corners, the material is double-sided, and a test asserts the face normal points up for several rotations.

## 2026-09-05: Four-option segmented control overflowed its track

The roof display switch was the first segmented control with four options, and the last pill was drawn outside the rounded track. The agent had never tested the component with more than three labels. Flex items now may shrink, groups with more than three options use the smaller text size, and a test covers the four-option case.

## 2026-09-05: Storey list broke the design system

The storey chooser was still a stacked list of bordered boxes with a blue left edge, a leftover from the first interface. The user pointed out it did not follow the rounded design and asked for a switch. The agent first built it horizontal; the user corrected that to vertical. It is now a rounded track with one pill per storey, top storey first like the building, and the actions for the active storey in a row underneath. Drag reordering went with it, the arrow buttons cover that.

## 2026-09-05: Doors only worked on the envelope

Rooms could be drawn but never connected: the Opening tool only accepted footprint walls, an agent simplification from the first spec. The user asked for openings on any wall. Openings now carry an `interior` flag and index the storey's interior walls, which share the exterior wall solids code. Energy and IFC deliberately skip them, since a door between two heated rooms is not an envelope loss.

## 2026-09-06: Audit of every formula before the interview

The user asked for a check of all numbers before accepting that the tool works. The audit found five errors in the agent's building physics, all in code that had green tests, because the tests pinned the agent's own numbers instead of the standard's:

- Heating degree hours were 84 kKh; the heating period method of DIN V 4108-6 uses 66 kKh for the German reference climate.
- Internal gains of 22 kWh/(m²a) were missing entirely.
- The floor slab on the ground and walls to unheated rooms counted in full; the EnEV temperature correction factors 0.6 and 0.5 now apply, in the energy balance and in the heat load.
- The design outdoor temperature for Berlin was −12 °C; DIN EN 12831 Beiblatt 1 gives −14 °C.
- The uninsulated floor and roof presets claimed U-values of 1.0 and 1.3 while their layer stacks computed 3.7 and 2.5, and the stack wins. The stacks now land on the IWU typology values, and the typed fallbacks match.

Before the fix the example house came out at 324 kWh/(m²a); after it, 252, which is where the IWU typology puts an uninsulated pre-1918 single-family house. The assumptions text on the Energy panel and in the print report also claimed that solar gains and thermal bridges were not included while the code included both; both texts now describe the method as computed.

## 2026-09-06: Building dimensions stay in geometry and survive rotation

The first implementation put rectangle detection and resizing in `src/lib/box.ts`, although the project rule keeps every geometry operation in `src/geometry/` with tests. It also recognised only rectangles aligned to the world axes, so rotating a building with the new Move tool immediately disabled its width and depth fields. The code moved to `src/geometry/box.ts`, rectangle detection now checks side lengths and right angles, and resizing preserves the centre and orientation. The building factory takes its id generator as an input so its result remains controlled in tests. Creating a replacement building also keeps the existing map origin, and loading it resets stale selection, hover and active zone state.

## 2026-09-06: German changed the interface but left the document data in English

Adilzhan switched the Altbau Kreuzberg example to German and found English names throughout Print, including the building title. The language action had changed only the interface dictionary while names generated in the model stayed in the language used when the document was created. Known generated and example names now translate in both directions for the building, storeys, rooms, zones, constructions, material layers and renovation scenarios. Names entered by the user remain unchanged. The same localization runs when a saved, imported or synchronized building enters the store, and language changes update undo and redo snapshots so an undo cannot bring English names back into a German document. Language switching still creates no history step. A print route regression test checks the German example document and rejects its English equivalents.

## 2026-09-06: The floating building name wrapped outside its chip

After the German document fix, Adilzhan found that "Altbau Kreuzberg, Baujahr 1905" wrapped into four lines while the floating chip stayed one line high. The chip had a fixed height but no rule preventing text wrapping. It now grows naturally with the name on one line up to a fixed maximum width. Longer custom names are clipped with an ellipsis inside the chip, while the complete name remains in its accessible label and the rename control. A component test covers the German example name and the sizing contract.

## 2026-09-06: The agent enlarged the wrong Energy element

Adilzhan reported that an element in the Energy panel had become too small and attached a screenshot. The agent assumed he meant the clipped scenario selector and changed it to two rows. He meant the colored Energy efficiency class scale directly below it. The unrelated selector change was reverted in the next commit. The panel scale now has its own compact 400-unit view box instead of sharing the 560-unit print proportions, which nearly doubles its rendered height at the same panel width. Its colored band, class letters, marker label and ticks all grow together. The print scale keeps its existing document proportions. The panel test checks both the current and renovated scale sizes.

## 2026-09-07: Wall snapping, right panel width, desktop size limit and IFC import

Adilzhan reported four issues during manual testing with screenshots:

1. Interior wall placement left a gap near the exterior wall and failed to split rooms. The agent's interior wall tool had snapped clicks exclusively to the 0.5 m grid, which left an 8.5 to 20 cm gap against the exterior wall's inner face. The fix introduces `snapToFootprintOrGrid` to project clicks inside the wall attachment zone directly onto the footprint edge, and disables 3D wall mesh raycasts during wall drawing so pointer events cleanly hit the level plane.
2. The Constructions section in the right panel broke visually with cramped inputs and misaligned buttons. The right panel column width was enlarged from 360 px to 440 px, and `min-w-0` styles plus a dedicated flex button group were applied to layer editor inputs.
3. The editor got squashed on medium viewports with the right panel cut off. The minimum window width requirement was raised from 1024 px to 1440 px, with updated localized guidance in English and German.
4. Foreign IFC import showed walls intersecting windows and protruding outside outer walls. The partition at x = 3 cut through the window at x = 2.0 to 3.2 in `foreign-sample.ifc` (window repositioned to x = 0.8 to 2.0). Interior wall import had been snapping extended endpoints to the 0.5 m grid, pushing them 20 cm outside the footprint; this was replaced by clipping to the footprint polygon and rounding to millimeter precision. Dedicated Import JSON and Import IFC buttons were added to the bottom bar.

## 2026-09-19: lod2-challenge moves into this repository

Adilzhan asked for one repository and one product instead of two: the LoD2 map with the facade photo tools, and this editor. The agent moved lod2-challenge in under `lod2/` with its package folder names kept, so their links to `lod2-core` and their tests work unchanged, and pointed every `.env` lookup at this repository's root. The LoD2 database keeps its own compose file and its compose project name, so the Berlin buildings already loaded are reused and `docker compose up` for Bauwerk's server never starts it. `npm run dev` became a small runner without dependencies that starts the database, applies migrations, then runs the API, the vision service when its Python exists, and the app, with one Ctrl+C for all. The merge into one app follows in stages: first one set of library versions (the viewer was on React 19 and fiber 9, the editor on 18 and 8), then the viewer's pages inside the app, then the redesign, so every stage can be checked on its own.

## 2026-09-25: The start page spoke to homeowners, not to consultants

The start page headline read "Einfach Adresse eingeben oder Gebäude auf der Karte per Klick auswählen ... und sofort Ihre Sanierung planen", a sales line for a homeowner. Adilzhan pointed out that the people using this are 20°'s energy consultants and asked whether the search should take a Gebäude-ID instead of an address. The address search stays: a job reaches a consultant as a street address, and nobody outside the cadastre knows the ALKIS id, which the search already accepts as well. The headline became a plain "Gebäude finden" with one line saying what can be searched and where the data comes from, in a smaller heading that leaves the search box as the first thing on the page.

## 2026-09-25: The file buttons went, the rest moved into the two pills

Adilzhan asked whether an energy consultant needs the JSON export, JSON import and IFC import in the bottom bar, which were built before the building came from its address and the LoD2 data. They do not: the building is found, not loaded from a file. The IFC export stays, because it carries the model into the consultant's calculation software, and so does the server PDF. He also found that the bottom bar next to the tool dock read as a second toolbar, and that the active tool's filled circle hid its shortcut number. The bottom bar is gone: IFC export and PDF sit in the view pill beside the printable report, and the floor area, the collaborators and the shortcut sheet close the tool dock. The shortcut number now has its own slot beside each tool circle. The import code in `src/geometry/` and its tests stay; only the buttons and their strings were removed.

## 2026-09-25: Redesign after the 20° app

Adilzhan asked for the look of the 20° app, from the one screenshot he had of it and from what Leon showed in the meeting, while keeping every feature Bauwerk already had. The agent sampled the colours from the screenshot (navy `#024e7b`, navy-black ink, green-grey muted text, a blue-grey scene) and read the fonts as Geist and Geist Mono: the mono values and the uppercase mono section labels are the giveaway, and Geist is what a Next.js app gets by default, so this is an informed guess, not a certainty. The rounded shell and the navigation rail became a white top bar with the building name, undo, the navy Export menu and the avatar; the side panels are docked and flush; the view switch reads 3D, top and the four elevations and moves the camera; the tool bar became a vertical card at the top left, as Adilzhan chose over keeping it at the bottom; a minimap sits at the bottom left. The left panel he remembered as Figma-like became a layers tree with an eye per storey. He asked to keep the axis gizmo and to make the plain grid the default ground with the map as a setting, which also exposed that the ground grid had never drawn at an angle: drei's infinite grid stretches its plane to about 68 km, and the slanted view clipped it away, so the grid is now a finite 300 m plane that fades out. Checking the minimap against the top view showed that the 3D scene is a mirror image of the map, east on the left; that predates the redesign and is logged in `TODO.md` rather than fixed here, because it touches how every tool maps a click to the plan.

## 2026-09-25: The custom cursor set goes

The SVG cursor set from the redesign (a drawn arrow, hand, I-beam and the rest, injected as a stylesheet over every element) was removed at Adilzhan's request. Seen in the photo editor screenshots, the drawn I-beam and hand looked foreign next to the operating system and read as a gimmick. The system cursors are back; only the cursors that carry meaning stay, as native keywords in `index.css`: grab on the 3D canvas, a crosshair for the drawing tools, and a resize arrow on scrubbing number labels.

## 2026-09-25: Operations with one server order, not a CRDT library

The collaboration layer was rebuilt for the third interview. Before, every change sent the whole building and the last write won, so two people editing two different windows overwrote each other. Now every change is diffed into small operations keyed by element id and field (`src/sync/ops.ts`), the server applies batches one at a time under a row lock, and every tab replays them in that order. This is the model Figma describes for its multiplayer: a central server orders, clients predict and rebase. It is not a CRDT, on purpose. A CRDT library (Yjs, Automerge) merges without a server and guarantees that everyone converges, but not that the result is a valid building. Two windows moved into the same spot converge perfectly into an overlap. Because there is a server anyway, it can run `validateBuilding` on the merged result and refuse the batch that broke it.

Two corrections came out of testing, not out of the plan. First, the server refused every invalid building. The first client tests moved the door onto a window and were refused, which exposed that this is wrong for this editor: it lets an opening sit in an invalid place for a while and draws it in the warning colour, and the refusal would have blamed "someone else" for the user's own edit. The client now sends whether its own result was valid, and the server only refuses a merge that breaks a building the sender saw as valid. Second, undo: the plan was to store inverse operations. Applying every remote batch to the undo and redo snapshots gives the same behaviour (undo takes back only your own edits, and never a field someone else changed after you) with less machinery.

The proof is a property test (`src/sync/convergence.test.ts`): three tabs, random edits, random delivery order, dropped and restored connections, 1000 seeds in CI. Every tab must end on the server's building, and the server's building must stay valid at every step. Before trusting it, three deliberate bugs were put in one at a time (no replay of the local queue, a server that accepts broken merges, no history rebase), and each was caught.

## 2026-09-27: A hosted demo, two repositories, accounts through our own server

For the office presentation the app moves off this PC. Four decisions, and what testing changed in them.

The portfolio and the demo are two repositories. The public `bauwerk` stays at the version the portfolio links to; the private `bauwerk-20grad` has everything since, and only it is deployed. The local remote for the public one has its push address disabled, so nothing reaches it by mistake. A fresh clone of the private one failed its type check at once, although this folder passed: `npm run setup` gives `lod2-core` its own zod, and the app wrapped lod2-core's schemas with a second zod copy. Only a clean clone could find that, which is why "a fresh clone runs green" was written into the task before any code.

The LoD2 data stays in PostGIS on the server, not in Supabase: 575 MB against the free plan's 500. It is public data that can be reloaded, and a 168 MB dump restores in twenty seconds. Supabase holds what is small and matters: accounts, projects, versions, memberships.

The browser never touches the Supabase database. It signs in with Supabase Auth and sends the token to the NestJS server, which verifies it against Supabase's key set and is the only one reading and writing the tables. The tables live in a schema of their own that the Data API does not serve, with row level security and no policies as a second lock. The alternative, the browser talking to Supabase directly with row level security policies, would put the geometry invariants and the operation merge on the client or into SQL.

What testing corrected: the server's migrations ran every file on every start, which would have recreated empty tables after moving them to the new schema, so each file now runs once and is recorded. The global REST guard also ran on socket messages, which have no HTTP headers, and failed every join; sockets are checked once, when they connect. Connecting to Supabase with `sslmode=require` fails in recent `pg` and `no-verify` would allow a man in the middle, so the server trusts Supabase's own certificate authority instead. SAM 3 is not on the server at all; a graphics card is rented by the hour for the presentation, behind a shared key the proxy adds, so the key never reaches a browser. Known gaps, on purpose for a demo: no email confirmation, no backups beyond the LoD2 dump, no monitoring.
