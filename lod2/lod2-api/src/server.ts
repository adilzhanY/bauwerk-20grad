/**
 * lod2-api: vector tiles, building detail, orthophoto crops, and on-demand ingestion.
 *
 * Sits directly on the same PostGIS the CLI writes to, and reuses the CLI's loader
 * for on-demand fetches, so there is exactly one fetch-parse-load path in the system.
 *
 * Read-only: every route here is a GET. There is no authentication, which is fine while this
 * listens on localhost and would not be if it listened anywhere else.
 */
import { fileURLToPath } from 'node:url'
import Fastify from 'fastify'
import cors from '@fastify/cors'
import compress from '@fastify/compress'
import { getAdapter, adapterCodes } from 'lod2-ingest/adapters'
import { PIPELINE_VERSION, BuildingDetailSchema } from 'lod2-core'
import {
  buildingDetail, buildingTile, coverageTile, findByGid, neighboursInBox, buildingAt, orthophotoCrop,
} from './queries.ts'
import { MIN_ZOOM, OnDemandFetcher, findUnfetchedTiles, resetStaleFetching } from './ondemand.ts'
import {
  UpstreamBusyError, fetchOrthophoto, getMapUrl, mercatorToLonLat, stateAt, tileBBox3857,
} from './orthophoto.ts'
import { checkDatabase, createIngestPool, createRequestPool } from './db.ts'
import { upstreamPacer } from './host-pacer.ts'
import {
  isValidGid, parseCorsOrigins, parseNeighbourBox, singleParam, isLonLat } from './params.ts'

/**
 * Configuration comes from a gitignored `.env` at the repo root, or from the real environment.
 *
 * Node reads it natively, so this needs no dependency, and doing it here rather than asking
 * whoever starts the server to remember an `export` is the difference between a DATABASE_URL
 * that survives a restart and one that does not. An absent file is the normal case, so it is
 * not an error.
 */
for (const candidate of ['../../../.env', '../../.env']) {
  try {
    process.loadEnvFile(fileURLToPath(new URL(candidate, import.meta.url)))
  } catch {
    // No file there, or unreadable: the environment stands on its own.
  }
}

// Named LOD2_* so a generic PORT or HOST set elsewhere on the machine cannot move the API.
const PORT = Number(process.env.LOD2_API_PORT ?? 8788)
const HOST = process.env.LOD2_API_HOST ?? '127.0.0.1'
/** Below this, a viewport covers so many footprints that the tile is not useful. */
const MIN_BUILDING_ZOOM = 13

/** A complete building tile only changes with a re-ingest, which is rare and deliberate. */
const TILE_MAX_AGE_S = 6 * 3600
/** How long shutdown waits for in-flight downloads before aborting them. */
const SHUTDOWN_WAIT_MS = 5_000
/** An aerial tile that would wait longer than this for its upstream slot is refused. */
const AERIAL_MAX_QUEUE_MS = 10_000

const pool = createRequestPool(10)
const ingestPool = createIngestPool(3)
const fetcher = new OnDemandFetcher(ingestPool)

const resetCount = await resetStaleFetching(pool)
if (resetCount > 0) console.log(`reset ${resetCount} stale 'fetching' tiles`)

const app = Fastify({
  logger: { level: process.env.LOG_LEVEL ?? 'warn' },
})

// The viewer goes through the Vite proxy, so only the dev server's own origins are allowed.
await app.register(cors, { origin: parseCorsOrigins(process.env.CORS_ORIGINS) })

// Client errors keep their status; anything else is logged and answered with a generic body,
// so database messages never reach the client.
app.setErrorHandler((err: { statusCode?: number; message: string }, req, reply) => {
  const status = err.statusCode ?? 500
  if (status < 500) return reply.code(status).send({ error: err.message })
  req.log.error({ err }, 'request failed')
  return reply.code(500).send({ error: 'internal error' })
})

// Neighbour meshes are a couple of megabytes of JSON coordinates, which is almost all
// repeated digits, it compresses to a fraction, and so do vector tiles. Images are already
// compressed, so they are left alone.
await app.register(compress, {
  global: true,
  threshold: 4096,
  encodings: ['br', 'gzip', 'deflate'],
  customTypes: /^application\/(json|vnd\.mapbox-vector-tile)/,
})

const parseTile = (p: { z: string; x: string; y: string }) => ({
  z: Number(p.z), x: Number(p.x), y: Number(p.y),
})
const validTile = (z: number, x: number, y: number) =>
  Number.isInteger(z) && Number.isInteger(x) && Number.isInteger(y) &&
  z >= 0 && z <= 24 && x >= 0 && y >= 0 && x < 2 ** z && y < 2 ** z

app.get<{ Params: { z: string; x: string; y: string } }>(
  '/tiles/:z/:x/:y.mvt',
  async (req, reply) => {
    const { z, x, y } = parseTile(req.params)
    if (!validTile(z, x, y)) return reply.code(400).send({ error: 'bad tile coordinates' })

    if (z < MIN_BUILDING_ZOOM) {
      return reply.header('Content-Type', 'application/vnd.mapbox-vector-tile').send(Buffer.alloc(0))
    }

    const mvt = await buildingTile(pool, z, x, y)

    // Only reach for source data once the user is actually looking at buildings. Below that
    // an unfetched source tile still means this tile will change once it is loaded.
    let queued = 0
    let dropped = 0
    const byState = await findUnfetchedTiles(pool, z, x, y)
    const unfetchedBelowFetchZoom = z < MIN_ZOOM && byState.size > 0
    if (z >= MIN_ZOOM) {
      for (const [state, tiles] of byState) {
        try {
          const res = fetcher.enqueue(getAdapter(state), tiles)
          queued += res.queued.length
          dropped += res.dropped
        } catch {
          // No adapter for that state yet, the tile index knows about it, we cannot fetch it.
        }
      }
    }

    // While any source tile is still on its way, this tile's content is about to change.
    const incomplete = unfetchedBelowFetchZoom || queued > 0 || dropped > 0 || fetcher.pendingCount > 0
    return reply
      .header('Content-Type', 'application/vnd.mapbox-vector-tile')
      .header('Cache-Control', incomplete ? 'no-store' : `public, max-age=${TILE_MAX_AGE_S}`)
      .send(mvt)
  },
)

app.get<{ Params: { z: string; x: string; y: string } }>(
  '/coverage/:z/:x/:y.mvt',
  async (req, reply) => {
    const { z, x, y } = parseTile(req.params)
    if (!validTile(z, x, y)) return reply.code(400).send({ error: 'bad tile coordinates' })
    const mvt = await coverageTile(pool, z, x, y, fetcher.pendingKeys())
    return reply
      .header('Content-Type', 'application/vnd.mapbox-vector-tile')
      .header('Cache-Control', 'no-store')
      .send(mvt)
  },
)

app.get<{ Params: { gid: string } }>('/buildings/:gid', async (req, reply) => {
  if (!isValidGid(req.params.gid)) return reply.code(400).send({ error: 'bad building id' })
  const detail = await buildingDetail(pool, req.params.gid)
  if (!detail) return reply.code(404).send({ error: 'not found' })
  // Validate on the way out: a schema drift should fail here, not in the browser.
  const parsed = BuildingDetailSchema.safeParse(detail)
  if (!parsed.success) {
    req.log.error({ issues: parsed.error.issues }, 'building detail failed its own schema')
    return reply.code(500).send({ error: 'response failed validation' })
  }
  return reply.send(parsed.data)
})

app.get<{ Params: { gid: string }; Querystring: Record<string, unknown> }>(
  '/buildings/:gid/neighbours',
  async (req, reply) => {
    if (!isValidGid(req.params.gid)) return reply.code(400).send({ error: 'bad building id' })
    // Metres across; the default matches the context orthophoto.
    const box = parseNeighbourBox(singleParam(req.query.box))
    if (box === null) return reply.code(400).send({ error: 'box must be a number of metres from 20 to 800' })
    // The building's own state decides the CRS the box is measured in, metres, not
    // degrees, so a 300 m box is 300 m everywhere rather than stretching with latitude.
    const { rows } = await pool.query<{ state: string }>(
      'SELECT state FROM building WHERE building_gid = $1 LIMIT 1',
      [req.params.gid],
    )
    const state = rows[0]?.state
    if (!state) return reply.code(404).send({ error: 'not found' })

    let epsg = 25833
    try {
      epsg = getAdapter(state).epsg
    } catch {
      // No adapter compiled in. 25833 is Berlin's zone; a wrong guess here would put the box
      // hundreds of kilometres away, so this is the value that matches the data we hold.
    }
    return reply.send(await neighboursInBox(pool, req.params.gid, box, epsg))
  },
)

/**
 * Find a building by Gebäude-ID.
 *
 * Prefix match on the AdV id, which is what you paste from another ALKIS tool. There is no
 * address search: Berlin's CityGML carries no addresses at all, so an address box would be a
 * field that never returns anything.
 */
app.get<{ Querystring: Record<string, unknown> }>('/search', async (req, reply) => {
  const q = (singleParam(req.query.q) ?? '').trim()
  if (q.length < 2 || !isValidGid(q)) return reply.send([])
  return reply.send(await findByGid(pool, q))
})

app.get<{ Querystring: Record<string, unknown> }>('/building-at', async (req, reply) => {
  const lon = Number(singleParam(req.query.lon))
  const lat = Number(singleParam(req.query.lat))
  if (!isLonLat(lon, lat)) return reply.code(400).send({ error: 'lon and lat must be numbers in range' })
  const gid = await buildingAt(pool, lon, lat)
  if (!gid) return reply.code(404).send({ error: 'no loaded building near this point' })
  return reply.send({ buildingGid: gid })
})

/**
 * Digital orthophoto crop of one building, cached: `roof` (tight, native resolution) or
 * `context` (800 m around it, for the ground and the neighbours).
 *
 * The bbox is computed here from the building, in the state's own CRS, the same frame as the
 * building meshes, so the client can drape the result by (x, y) without any projection maths.
 */
app.get<{ Params: { gid: string; kind: string } }>(
  '/orthophoto/:gid/:kind',
  async (req, reply) => {
    const { gid, kind } = req.params
    if (!isValidGid(gid) || (kind !== 'roof' && kind !== 'context')) {
      return reply.code(400).send({ error: 'needs a building id and roof or context' })
    }
    const crop = await orthophotoCrop(pool, gid, kind)
    if (!crop) return reply.code(404).send({ error: 'no imagery for this building' })

    try {
      const img = await fetchOrthophoto(pool, crop.adapter, crop.bbox, crop.maxPx)
      if (!img) return reply.code(404).send({ error: 'no imagery' })
      return reply
        .header('Content-Type', img.contentType)
        .header('Cache-Control', 'public, max-age=86400')
        .header('X-Lod2-Ortho-Cached', img.cached ? '1' : '0')
        .header('X-Lod2-Ortho-Size', `${img.widthPx}x${img.heightPx}`)
        .send(img.image)
    } catch (err) {
      if (err instanceof UpstreamBusyError) {
        return reply.code(503).header('Retry-After', '5').send({ error: 'upstream busy' })
      }
      // The viewer falls back to a flat colour, so this is not fatal. The detail (the upstream
      // host and its answer) is for the log, not the client.
      req.log.warn({ err }, 'orthophoto fetch failed')
      return reply.code(502).send({ error: 'orthophoto unavailable' })
    }
  },
)

/**
 * DOP as web-mercator map tiles, for the 2D aerial basemap.
 *
 * One route for every state, choosing the upstream by where the tile actually falls, so
 * adding a state adds no client-side layer. The alternative, one layer per state stacked in
 * the client, fetches every tile once per state and, worse, needs transparent PNG (8x the
 * bytes of JPEG for photography), because a WMS asked outside its own area returns an opaque
 * white image with 200 OK rather than an error.
 *
 * Backed by WMS GetMap rather than WMTS: Berlin's TrueDOP is published as a WMS, and where a
 * state does run a WMTS its matrix set tends not to be the standard {z}/{x}/{y} one.
 */
app.get<{ Params: { z: string; x: string; y: string } }>(
  '/aerial/:z/:x/:y.jpg',
  async (req, reply) => {
    const { z, x, y } = parseTile(req.params)
    if (!validTile(z, x, y)) return reply.code(400).send({ error: 'bad tile coordinates' })

    const bbox = tileBBox3857(z, x, y)
    const [lon, lat] = mercatorToLonLat((bbox[0] + bbox[2]) / 2, (bbox[1] + bbox[3]) / 2)

    let adapter
    try {
      const state = await stateAt(pool, lon, lat)
      if (!state) return reply.code(204).send()
      adapter = getAdapter(state)
    } catch {
      return reply.code(204).send()
    }
    const service = adapter.orthophoto
    if (!service) return reply.code(204).send()

    const url = getMapUrl(service, 3857, bbox, 256, 256)
    if (!(await upstreamPacer.wait(url, AERIAL_MAX_QUEUE_MS))) {
      return reply.code(503).header('Retry-After', '5').send({ error: 'upstream busy' })
    }
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(15_000) })
      const contentType = res.headers.get('content-type') ?? ''
      if (!res.ok || !contentType.startsWith('image/')) return reply.code(204).send()
      return reply
        .header('Content-Type', contentType)
        .header('Cache-Control', 'public, max-age=86400')
        .header('X-Lod2-Aerial-State', adapter.code)
        .send(Buffer.from(await res.arrayBuffer()))
    } catch {
      return reply.code(204).send()
    }
  },
)

app.get('/health', async (req, reply) => {
  const db = await checkDatabase(pool)
  if (!db.ok) {
    // The detail can carry the database host or the driver's message: the log keeps it.
    req.log.error({ detail: db.error }, 'health check failed')
    return reply.code(503).send({ ok: false, error: 'database unavailable' })
  }
  return reply.send({
    ok: true,
    states: adapterCodes,
    pipelineVersion: PIPELINE_VERSION,
    migration: db.migration,
  })
})

let closing = false
const close = async () => {
  if (closing) return
  closing = true
  await app.close()
  await fetcher.stop(SHUTDOWN_WAIT_MS)
  await Promise.all([pool.end(), ingestPool.end()])
  process.exit(0)
}
process.on('SIGINT', close)
process.on('SIGTERM', close)

await app.listen({ port: PORT, host: HOST })
console.log(`lod2-api on http://${HOST}:${PORT}  (states: ${adapterCodes.join(', ')})`)
