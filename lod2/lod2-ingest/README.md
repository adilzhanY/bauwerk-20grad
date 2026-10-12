# lod2-ingest

Crawls Berlin's LoD2 open-data portal and loads buildings into PostGIS. Also the CLI.

```
src/adapters/be.ts    everything specific to Berlin
src/adapters/index.ts the registry, one line per state
src/cli.ts            migrate · index · tiles · status
src/fetch-tile.ts     one tile as streamed text, with retries and an optional disk cache
src/unzip.ts          just enough ZIP to read one member
src/load.ts           the single fetch -> parse -> metrics -> PostGIS path
src/db.ts             pool, migrations, advisory-lock keys
migrations/           001-008, applied in filename order and recorded in a ledger table
```

## The adapter pattern

A `StateAdapter` (defined in `lod2-core/src/types.ts`) is configuration plus one method:

```ts
{ code, name, epsg, attribution, tileSizeM, emptyTileMaxBytes,
  archiveMember?, sizesAreApproximate?, orthophoto?, listTiles() }
```

Everything downstream (the crawler, the loader, the API, the viewer) is state-agnostic. Adding a
state is one file here and one line in `adapters/index.ts`. Note that the eastern states use
EPSG:25833 and the western ones 25832; the adapter carries the CRS and PostGIS reprojects.

The orthophoto service is a separate optional interface rather than a flag, so "this state has no
imagery wired up" is a first-class state the UI can explain rather than a crash.

## Berlin, and what its source does and does not give

Discovery is an INSPIRE download service: a catalogue feed pointing at `0.atom`, where every tile
sits as a `<link rel="section">` inside a single `<entry>`, around 925 of them, on a 1 km grid in
EPSG:25833.

**No file sizes.** No `<size>`, no per-file date, just one `<updated>` for the whole feed. So
every tile is advertised with `sizeBytes: 0`, which the loader treats as *unknown* rather than as
*empty*: `load.ts` guards its empty-tile skip with `sizeBytes > 0`. Two consequences: `--dry-run`
cannot tell you how many bytes an area will cost, and no tile is ever skipped without a request.
Fetching the sizes with HEAD does not scale against this server, which limits over time rather
than over concurrency: twenty requests succeed whether sequential or parallel, but of a full sweep
only 224 came back. `emptyTileMaxBytes` is kept at a plausible threshold so the skip starts
working by itself if Berlin ever publishes sizes.

**ZIP archives, and the member is `.xml`.** `archiveMember: /_BE\.xml$/i`, and the CityGML inside
is version 1.0. An archive has to be whole before anything can be read out of it (the central
directory is at the end), so that path buffers rather than streams. A Berlin tile is a few
megabytes compressed, which is the scale it is meant for.

**A filename with no UTM zone.** `LoD2_389_5819.zip` gives the south-west corner in kilometres and
nothing else, so a hard-coded state extent is the only guard against a misdecode. A Berlin tile
read as zone 32 would sit 400 km west and `ST_Transform` would carry that out without complaint,
so `listTiles()` throws instead.

**No addresses.** Not one building in Berlin's CityGML carries a `bldg:address`, so nothing
here stores or indexes them and the API has no address search. `load.ts` keeps whatever the
parser found on the row inside `metrics`, which is where a state that does ship addresses would
be picked up from.

## The CLI

```bash
node src/cli.ts migrate                      # apply migrations
node src/cli.ts index --state BE             # tile catalogue only, no geometry
node src/cli.ts tiles --state BE …           # ingest an area
node src/cli.ts status [--state BE]          # what is indexed and ingested
```

Area selection for `tiles`, one required. It refuses to select a whole state implicitly:

```
--bbox-wgs84 minlon,minlat,maxlon,maxlat
--bbox minx,miny,maxx,maxy       in the state's own CRS, metres
--around lon,lat --radius-km N
--tile id[,id…]
--all                            the entire state; check --dry-run first
```

Plus `--dry-run`, `--concurrency`, `--cache[=dir]`, `--limit`, `--force`.

## Catalogue first

`index` writes a row per tile (url, bbox, size, hash, timestamp) without downloading any
geometry. That is what makes "which source tile covers this point?" always answerable, which is
what lets the API fetch on demand as the map pans. Progress lives in a separate `tile_status`
table, so re-indexing never clears it.

`loadTile()` is the one path that fetches, parses, computes metrics and writes rows, and both the
CLI and the API call it. It holds a `pg_try_advisory_lock` keyed by `tileLockKey(state, tileId)`,
so the CLI and a map pan can never download the same tile twice, and it records
`geometry_repaired` where a footprint needed `ST_MakeValid`.

## Schema

`building` is one row per geometry-bearing feature (a standalone Building or a BuildingPart),
with the headline metrics denormalised into columns for querying, the rest in `metrics jsonb`, the
renderable geometry in `mesh jsonb`, and `flags text[]`. Footprints are stored in 4326 (`ground`)
with a 3857 mirror (`ground_3857`) for vector tiles, because one typed geometry column cannot hold
both UTM zones. Alongside: `building_roof_plane`,
`tile_index`, `tile_status`, and `orthophoto_cache`.

```bash
npm test        # the Berlin adapter against a saved feed, ZIP reading, lock keys. No network.
npm run typecheck
npm run lint
```
