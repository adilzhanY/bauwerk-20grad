#!/usr/bin/env node
/**
 * lod2: the ingest CLI.
 *
 *   lod2 migrate
 *   lod2 index  --state BE
 *   lod2 tiles  --state BE --bbox-wgs84 13.37,52.51,13.39,52.52 --dry-run
 *   lod2 status --state BE
 *
 * `index` downloads only a state's tile catalogue (a few MB, no CityGML) and is what
 * makes on-demand fetching possible later. `tiles` is the batch that actually downloads
 * geometry, and it always tells you how many bytes that will be before it starts.
 *
 * You do not have to batch-ingest at all: panning the viewer into un-ingested area makes the
 * API fetch the covering tiles on the fly. `tiles` is an optimisation for areas you use often.
 */
import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { PIPELINE_VERSION } from 'lod2-core'
import {
  parseArgs, parseBbox, parseLonLat, parsePositiveInt, parsePositiveNumber, str, valueOf,
  type Args,
} from './args.ts'
import { createPool, migrate } from './db.ts'
import { getAdapter, adapterCodes } from './adapters/index.ts'
import { loadTile } from './load.ts'
import type { TileRef } from 'lod2-core'
import type pg from 'pg'

function fmtBytes(n: number): string {
  if (n >= 1e9) return `${(n / 1e9).toFixed(2)} GB`
  if (n >= 1e6) return `${(n / 1e6).toFixed(1)} MB`
  return `${(n / 1e3).toFixed(0)} kB`
}

// --------------------------------------------------------------------------- index

/**
 * Whether a tile is known to hold no buildings.
 *
 * A size of zero means the source published none, not that the file is empty. Berlin's ATOM
 * feed carries no sizes at all. `load.ts` guards its skip the same way, and the report has to
 * agree with the behaviour or it tells the operator the opposite of what will happen.
 */
function isKnownEmpty(sizeBytes: number, threshold: number): boolean {
  return sizeBytes > 0 && sizeBytes <= threshold
}

async function cmdIndex(pool: pg.Pool, args: Args): Promise<void> {
  const code = str(args, 'state')
  if (!code) throw new Error(`--state is required (implemented: ${adapterCodes.join(', ')})`)
  const adapter = getAdapter(code)

  process.stderr.write(`Fetching ${adapter.name} tile index…\n`)
  const tiles = await adapter.listTiles()
  const totalBytes = tiles.reduce((s, t) => s + t.sizeBytes, 0)
  // The same guard the loader uses: a size of zero means "unknown", not "empty". Berlin's
  // ATOM feed carries no sizes at all, and without this the index would report all 925 of
  // its tiles as needing no download, the opposite of what then happens.
  const empty = tiles.filter((t) => isKnownEmpty(t.sizeBytes, adapter.emptyTileMaxBytes)).length
  const sized = tiles.filter((t) => t.sizeBytes > 0).length

  const CHUNK = 2000
  for (let i = 0; i < tiles.length; i += CHUNK) {
    const chunk = tiles.slice(i, i + CHUNK).map((t) => ({
      tile_id: t.id, url: t.url, size_bytes: t.sizeBytes, sha256: t.sha256,
      minx: t.bbox.minX, miny: t.bbox.minY, maxx: t.bbox.maxX, maxy: t.bbox.maxY,
      source_ts: t.sourceTs,
    }))
    await pool.query(
      `INSERT INTO tile_index (state, tile_id, url, size_bytes, sha256, epsg, bbox, source_ts)
       SELECT $1, r.tile_id, r.url, r.size_bytes, r.sha256, $2,
              ST_Transform(ST_MakeEnvelope(r.minx, r.miny, r.maxx, r.maxy, $2), 4326),
              nullif(r.source_ts,'')::timestamptz
       FROM jsonb_to_recordset($3::jsonb) AS r(
         tile_id text, url text, size_bytes bigint, sha256 text,
         minx double precision, miny double precision,
         maxx double precision, maxy double precision, source_ts text)
       ON CONFLICT (state, tile_id) DO UPDATE SET
         url = EXCLUDED.url, size_bytes = EXCLUDED.size_bytes, sha256 = EXCLUDED.sha256,
         bbox = EXCLUDED.bbox, source_ts = EXCLUDED.source_ts, indexed_at = now()`,
      [adapter.code, adapter.epsg, JSON.stringify(chunk)],
    )
    process.stderr.write(`  ${Math.min(i + CHUNK, tiles.length)}/${tiles.length}\r`)
  }
  process.stderr.write('\n')
  console.log(
    sized === 0
      // Berlin's feed publishes no sizes, so there is no total to report and no tile that
      // can be skipped unseen. Saying so beats printing a confident "0 kB".
      ? `${adapter.code} ${adapter.name}: indexed ${tiles.length} tiles; the source ` +
        'publishes no file sizes, so every tile is fetched to find out what it holds.'
      : `${adapter.code} ${adapter.name}: indexed ${tiles.length} tiles, ` +
        `${fmtBytes(totalBytes)} of CityGML upstream (${empty} empty tiles need no download).`,
  )
  console.log('No geometry was downloaded. Use `lod2 tiles` to ingest an area.')
}

// --------------------------------------------------------------------------- tiles

async function selectTiles(pool: pg.Pool, state: string, args: Args): Promise<TileRef[]> {
  const clauses: string[] = ['state = $1']
  const params: unknown[] = [state]

  const bboxUtm = valueOf(args, 'bbox')
  const bboxWgs = valueOf(args, 'bbox-wgs84')
  const around = valueOf(args, 'around')
  const tileArg = valueOf(args, 'tile')

  if (tileArg) {
    params.push(tileArg.split(','))
    clauses.push(`tile_id = ANY($${params.length})`)
  }
  if (bboxUtm) {
    const box = parseBbox(bboxUtm, '--bbox')
    params.push(box.minX, box.minY, box.maxX, box.maxY)
    clauses.push(
      `ST_Intersects(bbox, ST_Transform(ST_MakeEnvelope($${params.length - 3},$${params.length - 2},$${params.length - 1},$${params.length}, epsg), 4326))`,
    )
  }
  if (bboxWgs) {
    const box = parseBbox(bboxWgs, '--bbox-wgs84')
    params.push(box.minX, box.minY, box.maxX, box.maxY)
    clauses.push(
      `ST_Intersects(bbox, ST_MakeEnvelope($${params.length - 3},$${params.length - 2},$${params.length - 1},$${params.length}, 4326))`,
    )
  }
  if (around) {
    const point = parseLonLat(around, '--around')
    const radiusKm = parsePositiveNumber(valueOf(args, 'radius-km'), 1, '--radius-km')
    params.push(point.lon, point.lat, radiusKm * 1000)
    clauses.push(
      `ST_DWithin(bbox::geography, ST_SetSRID(ST_MakePoint($${params.length - 2},$${params.length - 1}),4326)::geography, $${params.length})`,
    )
  }
  if (!tileArg && !bboxUtm && !bboxWgs && !around && !args.all) {
    throw new Error('Refusing to select every tile in the state. Pass --bbox-wgs84, --bbox, --around, --tile, or --all.')
  }

  let sql = `SELECT tile_id, url, size_bytes, sha256, source_ts,
                    ST_XMin(bbox) AS minx, ST_YMin(bbox) AS miny,
                    ST_XMax(bbox) AS maxx, ST_YMax(bbox) AS maxy
             FROM tile_index WHERE ${clauses.join(' AND ')} ORDER BY tile_id`
  const limitArg = valueOf(args, 'limit')
  if (limitArg !== undefined) {
    params.push(parsePositiveInt(limitArg, 0, '--limit'))
    sql += ` LIMIT $${params.length}`
  }

  const { rows } = await pool.query(sql, params)
  return rows.map((r) => ({
    id: r.tile_id,
    url: r.url,
    sizeBytes: Number(r.size_bytes),
    sha256: r.sha256,
    bbox: { minX: r.minx, minY: r.miny, maxX: r.maxx, maxY: r.maxy },
    sourceTs: r.source_ts ? new Date(r.source_ts).toISOString() : null,
  }))
}

async function cmdTiles(pool: pg.Pool, args: Args): Promise<void> {
  const code = str(args, 'state')
  if (!code) throw new Error(`--state is required (implemented: ${adapterCodes.join(', ')})`)
  const adapter = getAdapter(code)
  // Checked before any query, so a typo fails at once rather than after the tile selection.
  const concurrency = parsePositiveInt(valueOf(args, 'concurrency'), 3, '--concurrency')

  const tiles = await selectTiles(pool, adapter.code, args)
  if (!tiles.length) {
    console.log('No tiles matched. Has `lod2 index` been run for this state?')
    return
  }

  const totalBytes = tiles.reduce((s, t) => s + t.sizeBytes, 0)
  const empties = tiles.filter((t) => isKnownEmpty(t.sizeBytes, adapter.emptyTileMaxBytes)).length
  const toDownload = totalBytes - tiles
    .filter((t) => isKnownEmpty(t.sizeBytes, adapter.emptyTileMaxBytes))
    .reduce((s, t) => s + t.sizeBytes, 0)
  const unsized = tiles.filter((t) => t.sizeBytes === 0).length

  console.log(`${adapter.code}: ${tiles.length} tiles selected, ${fmtBytes(totalBytes)} total`)
  if (unsized) {
    // Saying "0 bytes to download" would be a lie of arithmetic rather than of intent.
    console.log(`  ${unsized} of them advertise no size (the source does not publish one)`)
  }
  console.log(`  ${empties} empty (skipped without a request), ~${fmtBytes(toDownload)} to download`)

  if (args['dry-run']) {
    console.log('\nDry run, nothing downloaded. Drop --dry-run to ingest.')
    return
  }

  const cache = args.cache === true || typeof args.cache === 'string'
  const cacheDir = typeof args.cache === 'string' ? args.cache : '.cache/tiles'
  const skipUnchanged = args.force !== true

  let done = 0
  let buildings = 0
  let failed = 0
  const started = Date.now()
  const queue = [...tiles]

  const worker = async (): Promise<void> => {
    for (;;) {
      const tile = queue.shift()
      if (!tile) return
      const res = await loadTile(pool, adapter, tile, {
        cachePath: cache ? `${cacheDir}/${adapter.code}/${tile.id}.gml` : undefined,
        skipUnchanged,
      })
      done++
      buildings += res.buildings + res.parts
      if (res.status === 'failed') {
        failed++
        process.stderr.write(`\n  ! ${tile.id}: ${res.error}\n`)
      }
      const pct = ((done / tiles.length) * 100).toFixed(0)
      process.stderr.write(
        `  ${done}/${tiles.length} (${pct}%), ${buildings} features, ${failed} failed\r`,
      )
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, tiles.length) }, worker))
  process.stderr.write('\n')

  const secs = (Date.now() - started) / 1000
  console.log(
    `Ingested ${buildings} features from ${tiles.length} tiles in ${secs.toFixed(1)}s` +
    (failed ? ` (${failed} tiles failed)` : ''),
  )
}

// -------------------------------------------------------------------------- status

async function cmdStatus(pool: pg.Pool, args: Args): Promise<void> {
  const state = str(args, 'state')
  const where = state ? 'WHERE state = $1' : ''
  const params = state ? [state] : []

  const idx = await pool.query(
    `SELECT state, count(*) tiles, sum(size_bytes) bytes FROM tile_index ${where}
     GROUP BY state ORDER BY state`, params)
  const st = await pool.query(
    `SELECT state, status, count(*) n, sum(building_count) features FROM tile_status ${where}
     GROUP BY state, status ORDER BY state, status`, params)
  const b = await pool.query(
    `SELECT state, count(*) rows, count(*) FILTER (WHERE has_geometry) with_geom,
            count(DISTINCT building_gid) buildings,
            round(sum(volume::float8)::numeric) volume,
            round(sum(roof_area_3d::float8)::numeric) roof
     FROM building ${where} GROUP BY state ORDER BY state`, params)

  console.log('Tile index:')
  for (const r of idx.rows) console.log(`  ${r.state}: ${r.tiles} tiles, ${fmtBytes(Number(r.bytes))} upstream`)
  console.log('Tile status:')
  for (const r of st.rows) console.log(`  ${r.state} ${r.status}: ${r.n} tiles, ${r.features ?? 0} features`)
  const versions = await pool.query(
    `SELECT state, pipeline_version, count(*) n FROM building ${where}
     GROUP BY state, pipeline_version ORDER BY state, pipeline_version`, params)

  console.log('Buildings:')
  for (const r of b.rows) {
    console.log(
      `  ${r.state}: ${r.buildings} buildings (${r.rows} rows, ${r.with_geom} with geometry), ` +
      `${r.volume} m3, ${r.roof} m2 roof`,
    )
  }
  if (!b.rows.length) console.log('  (none yet)')

  // Two long-lived writers (this CLI and the API's on-demand fetcher) each hold
  // lod2-core in memory. Restart only one after a metric change and the table quietly
  // holds two vintages of equally plausible numbers, so surface them.
  const stale = versions.rows.filter((r) => Number(r.pipeline_version) !== PIPELINE_VERSION)
  if (stale.length) {
    console.log(`\nStale rows (current pipeline is v${PIPELINE_VERSION}):`)
    for (const r of stale) {
      console.log(`  ${r.state} v${r.pipeline_version}: ${r.n} rows, re-ingest with --force`)
    }
  }
}

// ----------------------------------------------------------------------------- main

/**
 * Read the repo-root `.env`, the same file the API reads, so both talk to the same database.
 * Variables already set in the environment win over the file.
 */
function loadRootEnv(): void {
  const path = fileURLToPath(new URL('../../../.env', import.meta.url))
  if (existsSync(path)) process.loadEnvFile(path)
}

async function main(): Promise<void> {
  loadRootEnv()
  const args = parseArgs(process.argv.slice(2))
  const cmd = args._[0]
  const pool = createPool()
  try {
    switch (cmd) {
      case 'migrate': {
        const applied = await migrate(pool)
        console.log(applied.length ? `Applied: ${applied.join(', ')}` : 'Already up to date.')
        break
      }
      case 'index': await cmdIndex(pool, args); break
      case 'tiles': await cmdTiles(pool, args); break
      case 'status': await cmdStatus(pool, args); break
      default:
        console.log(`lod2: German LoD2 ingest

  migrate                      apply database migrations
  index  --state BE            fetch a state's tile catalogue (no geometry downloaded)
  tiles  --state BE …          ingest an area; always dry-run first
  status [--state BE]          what is indexed and ingested

Area selection for \`tiles\` (one required):
  --bbox-wgs84 minlon,minlat,maxlon,maxlat
  --bbox minx,miny,maxx,maxy       in the state's own CRS (metres)
  --around lon,lat --radius-km N
  --tile id[,id…]
  --all                            the entire state, check --dry-run first

Options: --dry-run  --concurrency N (default 3)  --cache[=dir]  --limit N  --force

Implemented states: ${adapterCodes.join(', ')}`)
    }
  } finally {
    await pool.end()
  }
}

main().catch((err) => {
  console.error(`\nError: ${(err as Error).message}`)
  process.exitCode = 1
})
