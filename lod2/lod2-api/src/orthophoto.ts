/**
 * Digital orthophoto (DOP) fetching, cached in Postgres.
 *
 * Requests are proxied rather than made from the browser, even though the service sends
 * permissive CORS headers. Going direct would put one uncached GetMap per selection per user
 * against gdi.berlin.de, and would bypass the per-host pacing the rest of the app is careful
 * about.
 */
import { createHash } from 'node:crypto'
import type pg from 'pg'
import type { OrthophotoService, StateAdapter } from 'lod2-core'
import { upstreamPacer } from './host-pacer.ts'

const FETCH_TIMEOUT_MS = 20_000
/**
 * Never ask for more pixels than this, whatever the server would allow.
 *
 * The cap is there to protect the upstream service and our own memory, not to save
 * bandwidth -- so it has to sit above what native resolution actually needs, or it silently
 * becomes the thing that limits image quality. The 800 m context crop wants 4000 px at
 * Berlin's 20 cm; a cap below that would serve a blurred image and look like poor data.
 *
 * 4096 clears it and stays inside the texture size every WebGL2 implementation is required
 * to support.
 */
const HARD_MAX_PX = 4096
/**
 * Below this many pixels, ask for PNG rather than JPEG.
 *
 * JPEG costs about 7% of the finest detail in aerial imagery -- measured, as the drop in
 * mean absolute neighbour difference against a lossless request of the same crop. On a
 * 300 m context image that is worth paying for, at a thirteenth of the bytes. On the tight
 * crop draped over the selected building's roof, which is the one image anybody looks at
 * closely, it is not.
 */
const LOSSLESS_MAX_PX = 1_500_000

export interface OrthoRequest {
  state: string
  bbox: [number, number, number, number]
  px: number
}

export interface OrthoImage {
  image: Buffer
  contentType: string
  widthPx: number
  heightPx: number
  cached: boolean
}

function cacheKey(
  service: OrthophotoService,
  state: string,
  bbox: number[],
  w: number,
  h: number,
  format: string,
): string {
  const parts = [state, service.layer, w, h, format, ...bbox.map((v) => v.toFixed(3))].join('|')
  return createHash('sha256').update(parts).digest('hex').slice(0, 32)
}

/**
 * Pixel dimensions for a bbox: native resolution, but capped, and preserving the bbox
 * aspect ratio exactly.
 *
 * Aspect ratio is the part that matters. A GetMap whose width:height disagrees with its
 * bbox comes back stretched, and since the UV mapping assumes the image spans exactly the
 * requested bbox, every texture would be subtly skewed, a failure that looks like bad
 * data rather than a bug.
 */
export function pixelSize(
  bbox: [number, number, number, number],
  gsdM: number,
  maxPx: number,
): { width: number; height: number } {
  const spanX = Math.max(bbox[2] - bbox[0], 0.01)
  const spanY = Math.max(bbox[3] - bbox[1], 0.01)
  const cap = Math.min(maxPx, HARD_MAX_PX)

  let width = Math.round(spanX / gsdM)
  let height = Math.round(spanY / gsdM)
  const longest = Math.max(width, height)
  if (longest > cap) {
    const scale = cap / longest
    width = Math.round(width * scale)
    height = Math.round(height * scale)
  }
  return { width: Math.max(width, 16), height: Math.max(height, 16) }
}

/**
 * WMS 1.1.1 uses SRS and 1.3.0 uses CRS; for projected CRSs the axis order is the same.
 *
 * `transparent` matters more than it looks. Asked for a bbox outside its own state, a WMS
 * does not error, it returns a perfectly valid *white* image with 200 OK. Stack two
 * states' layers as opaque JPEG and whichever sits on top paints white over the other.
 * Transparent PNG makes out-of-coverage areas actually empty, so layers can be stacked
 * without knowing each state's boundary.
 */
export function getMapUrl(
  service: OrthophotoService,
  epsg: number,
  bbox: [number, number, number, number],
  width: number,
  height: number,
  opts: { transparent?: boolean; lossless?: boolean } = {},
): string {
  const transparent = opts.transparent ?? false
  const lossless = opts.lossless ?? false
  const params = new URLSearchParams({
    SERVICE: 'WMS',
    VERSION: service.version,
    REQUEST: 'GetMap',
    LAYERS: service.layer,
    STYLES: '',
    // JPEG is far smaller for photography, so it stays the default -- except where the crop
    // is small enough that losing detail to compression costs more than the bytes save.
    FORMAT: transparent || lossless ? 'image/png' : 'image/jpeg',
    TRANSPARENT: transparent ? 'TRUE' : 'FALSE',
    WIDTH: String(width),
    HEIGHT: String(height),
    BBOX: bbox.join(','),
  })
  params.set(service.version === '1.3.0' ? 'CRS' : 'SRS', `EPSG:${epsg}`)
  return `${service.wmsUrl}?${params}`
}

/**
 * Whether a bbox in the state's own CRS touches any of that state's indexed tiles.
 *
 * Checked before a crop is fetched and cached, so a bbox far outside the state cannot fill
 * the cache with blank images.
 */
export async function bboxInState(
  pool: pg.Pool,
  state: string,
  epsg: number,
  bbox: [number, number, number, number],
): Promise<boolean> {
  const { rows } = await pool.query<{ hit: boolean }>(
    `SELECT EXISTS (
       SELECT 1 FROM tile_index
        WHERE state = $1
          AND bbox && ST_Transform(ST_MakeEnvelope($2, $3, $4, $5, $6::integer), 4326)
     ) AS hit`,
    [state, bbox[0], bbox[1], bbox[2], bbox[3], epsg],
  )
  return rows[0]?.hit ?? false
}

/**
 * Fetch one DOP crop, serving from the cache when the exact same request has been made
 * before. `bbox` is in the adapter's own CRS.
 */
export async function fetchOrthophoto(
  pool: pg.Pool,
  adapter: StateAdapter,
  bbox: [number, number, number, number],
  /**
   * Cap the caller wants, narrower than the service's own.
   *
   * Needed because the descriptor and this route must agree: `buildingDetail` advertises
   * widthPx/heightPx for each crop, and the viewer's UV mapping assumes the image it gets
   * back spans exactly the advertised bbox at exactly that size. Recomputing the size here
   * from `service.maxPx` alone made the context crop arrive at 4000 px while the descriptor
   * said 2048, the drape still lined up, but every saving the smaller cap was there to make
   * was silently undone.
   *
   * Only ever narrows: a request cannot talk the upstream into more pixels than it allows.
   */
  maxPx?: number,
): Promise<OrthoImage | null> {
  const service = adapter.orthophoto
  if (!service) return null

  const cap = maxPx && maxPx > 0 ? Math.min(maxPx, service.maxPx) : service.maxPx
  const { width, height } = pixelSize(bbox, service.gsdM, cap)
  const lossless = width * height <= LOSSLESS_MAX_PX
  const key = cacheKey(service, adapter.code, bbox, width, height, lossless ? 'png' : 'jpeg')

  const hit = await pool.query<{ image: Buffer; content_type: string; width_px: number; height_px: number }>(
    `UPDATE orthophoto_cache SET hits = hits + 1 WHERE key = $1
     RETURNING image, content_type, width_px, height_px`,
    [key],
  )
  if (hit.rows[0]) {
    const r = hit.rows[0]
    return {
      image: r.image, contentType: r.content_type,
      widthPx: r.width_px, heightPx: r.height_px, cached: true,
    }
  }

  const url = getMapUrl(service, adapter.epsg, bbox, width, height, { lossless })
  await upstreamPacer.wait(url)

  const res = await fetch(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) })
  if (!res.ok) throw new Error(`${adapter.code} DOP WMS returned ${res.status}`)

  const contentType = res.headers.get('content-type') ?? 'image/jpeg'
  // A WMS reports errors as an XML ServiceException with a 200, so trust the body's
  // content type rather than the status code.
  if (!contentType.startsWith('image/')) {
    const body = (await res.text()).slice(0, 300)
    throw new Error(`${adapter.code} DOP WMS returned ${contentType}: ${body}`)
  }
  const image = Buffer.from(await res.arrayBuffer())

  await pool.query(
    `INSERT INTO orthophoto_cache
       (key, state, layer, epsg, min_x, min_y, max_x, max_y,
        width_px, height_px, content_type, image, bytes)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
     ON CONFLICT (key) DO NOTHING`,
    [key, adapter.code, service.layer, adapter.epsg,
     bbox[0], bbox[1], bbox[2], bbox[3],
     width, height, contentType, image, image.length],
  )

  return { image, contentType, widthPx: width, heightPx: height, cached: false }
}

/** Square bbox of the given half-width around a centre, in the adapter's CRS. */
export function squareAround(
  cx: number, cy: number, halfM: number,
): [number, number, number, number] {
  return [cx - halfM, cy - halfM, cx + halfM, cy + halfM]
}

/**
 * Which state covers a given lon/lat, from the indexed tile catalogue.
 *
 * Rectangles, not boundaries, the extent of each state's indexed tiles. Two consequences
 * follow, and both used to be wrong.
 *
 * **The smallest match wins.** State extents nest: Berlin's sits wholly inside Brandenburg's,
 * and Bremen's inside Lower Saxony's. Returning the first match would make the answer depend
 * on the row order of an unordered `GROUP BY`, and the failure is silent, a WMS asked for
 * ground it does not hold returns a perfectly valid *white* image with 200 OK. Berlin is the
 * only indexed state here, so this matters the moment a second one is added.
 *
 * **The cache expires.** It is consulted once per aerial map tile, so it has to be cached;
 * but it was cached for the life of the process, which meant a freshly indexed state stayed
 * invisible until somebody restarted the API. A minute is short enough that nobody notices
 * and long enough that a pan costs one query.
 */
interface StateBounds {
  state: string
  minLon: number
  minLat: number
  maxLon: number
  maxLat: number
  /** Degree area. Only ever compared with other extents in Germany, so no geodesy needed. */
  area: number
}

const STATE_BOUNDS_TTL_MS = 60_000

let stateBounds: StateBounds[] | null = null
let stateBoundsAt = 0
/** A cold cache under a burst of aerial tiles should issue one query, not sixty. */
let stateBoundsInflight: Promise<StateBounds[]> | null = null

async function loadStateBounds(pool: pg.Pool): Promise<StateBounds[]> {
  const { rows } = await pool.query(
    `SELECT state,
            ST_XMin(e) min_lon, ST_YMin(e) min_lat,
            ST_XMax(e) max_lon, ST_YMax(e) max_lat
       FROM (SELECT state, ST_Extent(bbox)::geometry e FROM tile_index GROUP BY state) s`,
  )
  return rows
    .map((r) => ({
      state: r.state as string,
      minLon: Number(r.min_lon), minLat: Number(r.min_lat),
      maxLon: Number(r.max_lon), maxLat: Number(r.max_lat),
    }))
    .map((b) => ({ ...b, area: (b.maxLon - b.minLon) * (b.maxLat - b.minLat) }))
    // Sorted here rather than in SQL: it keeps the query unchanged and makes the ordering
    // testable without a database.
    .sort((a, b) => a.area - b.area)
}

export async function stateAt(pool: pg.Pool, lon: number, lat: number): Promise<string | null> {
  if (!stateBounds || Date.now() - stateBoundsAt > STATE_BOUNDS_TTL_MS) {
    stateBoundsInflight ??= loadStateBounds(pool)
    try {
      stateBounds = await stateBoundsInflight
      stateBoundsAt = Date.now()
    } finally {
      stateBoundsInflight = null
    }
  }
  for (const b of stateBounds) {
    if (lon >= b.minLon && lon <= b.maxLon && lat >= b.minLat && lat <= b.maxLat) return b.state
  }
  return null
}

/** Drop the cached extents. For tests, and for a process that has just indexed a state. */
export function resetStateBounds(): void {
  stateBounds = null
  stateBoundsAt = 0
}

/** Web-mercator tile bounds, in metres. */
export function tileBBox3857(z: number, x: number, y: number): [number, number, number, number] {
  const SPAN = 20037508.342789244
  const size = (SPAN * 2) / 2 ** z
  return [-SPAN + x * size, SPAN - (y + 1) * size, -SPAN + (x + 1) * size, SPAN - y * size]
}

/** Web-mercator metres back to lon/lat, for picking the covering state. */
export function mercatorToLonLat(mx: number, my: number): [number, number] {
  const lon = (mx / 20037508.342789244) * 180
  let lat = (my / 20037508.342789244) * 180
  lat = (180 / Math.PI) * (2 * Math.atan(Math.exp((lat * Math.PI) / 180)) - Math.PI / 2)
  return [lon, lat]
}
