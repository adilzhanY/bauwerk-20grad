# lod2-core

The pure layer: CityGML parsing, geometry, metrics, terrain, codelists and the wire contract.
No database, no network, no framework — which is what lets the CLI, the API and the browser
compute identical numbers from identical code.

Consumed as a `file:` dependency with an `exports` map pointing straight at `.ts` source.
Nothing is compiled; Node runs the TypeScript as-is.

```
src/types.ts       domain types, and the StateAdapter / OrthophotoService interfaces
src/parser.ts      streaming CityGML reader for the AdV LoD2 profile
src/geometry.ts    vector maths, normals, areas, triangulation, volume, ortho UVs
src/metrics.ts     the energy-relevant numbers, the mesh, the footprint, PIPELINE_VERSION
src/terrain.ts     a ground surface warped to the models' own contact lines
src/codelists.ts   vendored AdV code lists — roof form, building function
src/api.ts         zod schemas shared by lod2-api and lod2-viewer
```

## The parser

`streamBuildings()` is SAX-based and streams: one square-kilometre tile holds a few thousand
buildings and tens of megabytes of coordinates, so nothing is held beyond the building currently
being read.

It is deliberately not a general CityGML implementation. It targets the profile the German states
ship, and it classifies elements by **namespace URI plus local name** rather than by prefix or
version. That is why Berlin's CityGML 1.0 reads unchanged alongside the 2.0 most states publish —
verified by running it against both fixtures, not by reading the schema.

Two structural things it does not paper over:

- **`bldg:BuildingPart` is emitted as its own record**, with `parentGid` set, and the loader
  aggregates. Dropping parts silently loses geometry for a meaningful fraction of German
  buildings; a parent that carries attributes but no geometry of its own is a normal case, not an
  error.
- **`ClosureSurface` keeps its own kind.** A closure surface is a virtual lid: it counts toward
  the solid, so the volume is right, and never toward wall area, so that is right too. Folding it
  into walls would quietly inflate every facade figure.

## The metrics

`computeMetrics()` produces what an energy assessment needs: footprint area, roof area in 3D and
in horizontal projection, wall area, enclosed volume, ground/min/max z, eave and ridge height,
and per-roof-plane area, azimuth and tilt.

Some deliberate choices in there:

- **Volume by the divergence theorem, rebased.** Coordinates are UTM, so x is around 390,000 and
  y around 5,819,000. Integrating without rebasing to a local origin throws away most of the
  available precision on numbers that cancel.
- **Triangulation restores winding.** `earcut` is 2D, so each face is projected onto its own
  plane, triangulated, and the winding restored to match the face's own normal — which is why
  lighting is correct without `DoubleSide`.
- **`buriedDepth` is how far the ground climbs *up* the walls.** LoD2 models no basement: the
  solid starts at the floor slab. Null where the source publishes no contact line.
- **Problems are flagged, not hidden.** `solid-not-closed`, `degenerate-polygon`,
  `ground-z-spread`, `height-mismatch`, `implausible-volume`, `no-terrain-curve`,
  `no-geometry` — all carried on the building and shown in the panel. A volume from a
  non-watertight solid is not trustworthy, and the flag is how you know.
- **`PIPELINE_VERSION`** is stamped on every row the loader writes, so a stale ingest is visible
  through `lod2 status` rather than silently mixed in with a newer one.

The cross-check that matters: computed ridge height against the publisher's own
`bldg:measuredHeight`. If the ground plane or the roof extraction were wrong, those two would
diverge — so `metrics.test.ts` asserts they agree, on whatever fixture it is given.

## The terrain

`buildTerrainMesh()` builds a ground surface from `bldg:lod2TerrainIntersection` — the line where
a building's walls meet the ground, and the only height information in the data. Heights exist
along walls and nowhere else, so everything between them is an interpolation: exact along the
selected building's own line, interpolated between its neighbours', flat where there are none.
Honest as a picture of the ground, and not to be read as a survey.

The design turns on one fact about how the result is drawn. The orthophoto's UV is a function of
x and y alone and the material is unlit, so two surfaces overlapping in plan view produce
*identical pixels* whatever their heights. Overlap is therefore free — which is what lets an
exactly-placed collar along the contact line meet a coarse interpolated grid without stitching
them together. No constrained triangulation, no extra dependency.

`sampleHeight` chooses between two strategies by how many constraints there are, and the
reason is worth stating because it is a 100× difference rather than a tuning question. A ring
search over the bucket grid is O((d/cell)²) in the distance to the nearest constraint:
unbeatable when the cloud is dense, ruinous when it is not. A flat scan is O(n) whatever the
distance. The sparse case is not hypothetical — every selection in the viewer builds the
ground once from the selected building's own contact line alone, a few dozen points against a
grid spanning 800 m, so nearly every probe is hundreds of metres from anything. That pass
measured 20.8 seconds in Chrome and hung the tab; scanning instead takes about 160 ms. Both
paths share `idw` so they cannot drift apart, and `test/terrain.test.ts` guards the crossover
against brute force and the sparse case against regression.

`TerrainInput.field` is the seam for a real terrain model: supply a height callback and it
replaces the interpolation entirely, with the contact lines then only deciding whether there is
anything to warp at all. Nothing in this project supplies one — see the note in the root README.

## The wire contract

`src/api.ts` holds the zod schemas for everything that crosses between `lod2-api` and
`lod2-viewer`. The server validates what it emits and the client validates what it receives, so
a drift between them is a test failure rather than a runtime surprise in the browser.

Fields added later are `nullish` with a default, because the two sides are deployed separately and
are briefly out of step every time either restarts. A server older than a field should cost that
field, not the whole building.

`MeshSchema.terrain` is the contact-line rings, and it is **absent** rather than empty where the
source publishes none — an absent key and an empty array are different claims.

## Fixtures

`fixtures/be-sample.gml` — Berlin. CityGML 1.0, UTM33, BuildingParts, ClosureSurfaces, contact
lines on most buildings, and no addresses at all.

`fixtures/nrw-sample.gml` — a trimmed tile from another state, kept on purpose. It is CityGML
**2.0** in UTM**32**, and it covers the structurally awkward cases: a parent building with no
geometry of its own, BuildingParts inheriting their parent's attributes, ClosureSurfaces. Having
both versions is what keeps the parser namespace-driven rather than Berlin-specific — if it ever
regresses to matching prefixes, one of these two files will fail.

```bash
npm test        # 65 assertions, no network
npm run typecheck
npm run lint
```
