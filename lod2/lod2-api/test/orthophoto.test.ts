import { mock, test } from 'node:test'
import assert from 'node:assert/strict'
import type pg from 'pg'
import type { OrthophotoService } from 'lod2-core'
import {
  getMapUrl, mercatorToLonLat, pixelSize, resetStateBounds, stateAt, tileBBox3857,
} from '../src/orthophoto.ts'

/** Shaped like Berlin's TrueDOP: WMS 1.3.0 at 20 cm. */
const berlin: OrthophotoService = {
  wmsUrl: 'https://example.test/wms', layer: 'truedop_2026', version: '1.3.0',
  gsdM: 0.2, maxPx: 8000, trueOrtho: true, attribution: 'x', licence: 'y',
}
/** Same service on the older WMS version, which spells the CRS parameter differently. */
const oldVersion: OrthophotoService = { ...berlin, version: '1.1.1' }

test('pixel size follows native resolution', () => {
  // 24 x 18 m at 20 cm/px.
  const { width, height } = pixelSize([0, 0, 24, 18], 0.2, 8000)
  assert.equal(width, 120)
  assert.equal(height, 90)
})

test('pixel size preserves the bbox aspect ratio when capping', () => {
  // Aspect is what matters: the UV mapping assumes the image spans exactly the bbox, so a
  // width:height that disagrees with it would skew every texture rather than fail loudly.
  const bbox: [number, number, number, number] = [0, 0, 1000, 250]
  const { width, height } = pixelSize(bbox, 0.2, 9000)
  const bboxAspect = 1000 / 250
  assert.ok(Math.abs(width / height - bboxAspect) / bboxAspect < 0.01,
    `image aspect ${width / height} vs bbox aspect ${bboxAspect}`)
  assert.ok(Math.max(width, height) <= 4096, 'must respect the hard pixel cap')
})

test('the neighbour context crop is not capped below native resolution', () => {
  // The 800 m box a building's neighbours are draped from wants 4000 px at the DOP's own
  // 20 cm, so the 4096 hard cap has to sit above it. A cap below that would quietly serve a
  // coarser image — imagery that looks like the data is poor rather than like the code chose
  // to blur it.
  const bbox: [number, number, number, number] = [0, 0, 800, 800]
  const { width, height } = pixelSize(bbox, 0.2, 8000)
  assert.equal(width, 4000)
  assert.equal(height, 4000)
})

test('a narrower cap than the service allows is honoured', () => {
  // The descriptor in `buildingDetail` advertises widthPx/heightPx per crop and the route
  // must serve exactly that, so the cap has to be able to travel with the request. The
  // context crop uses this to avoid a 4000 px image nobody looks at closely.
  const native = pixelSize([0, 0, 800, 800], 0.2, 8000)
  assert.deepEqual(native, { width: 4000, height: 4000 }, 'native resolution for reference')

  const capped = pixelSize([0, 0, 800, 800], 0.2, 2048)
  assert.deepEqual(capped, { width: 2048, height: 2048 })
})

test('a cap wider than the service allows cannot talk it into more pixels', () => {
  // maxPx only ever narrows. `fetchOrthophoto` takes Math.min of the two, and the hard cap
  // applies on top of both — otherwise a crafted request becomes a denial-of-service against
  // a public authority server.
  const asked = pixelSize([0, 0, 4000, 4000], 0.2, 99_999)
  assert.ok(Math.max(asked.width, asked.height) <= 4096, `got ${asked.width}x${asked.height}`)
})

test('pixel size never returns a degenerate image', () => {
  const { width, height } = pixelSize([0, 0, 0.001, 0.001], 0.2, 8000)
  assert.ok(width >= 16 && height >= 16)
})

test('GetMap uses CRS for WMS 1.3.0 and SRS for 1.1.1', () => {
  // The one real difference between the two versions for our purposes; getting it wrong
  // yields a service exception rather than an image.
  const a = new URL(getMapUrl(berlin, 25833, [1, 2, 3, 4], 100, 100))
  assert.equal(a.searchParams.get('CRS'), 'EPSG:25833')
  assert.equal(a.searchParams.get('SRS'), null)

  const b = new URL(getMapUrl(oldVersion, 25833, [1, 2, 3, 4], 100, 100))
  assert.equal(b.searchParams.get('SRS'), 'EPSG:25833')
  assert.equal(b.searchParams.get('CRS'), null)
})

test('GetMap defaults to opaque JPEG, and switches to transparent PNG on request', () => {
  // A WMS asked outside its own area answers with an opaque white image and HTTP 200,
  // so stacked map layers must be transparent or the top one erases the others.
  const opaque = new URL(getMapUrl(berlin, 3857, [1, 2, 3, 4], 256, 256))
  assert.equal(opaque.searchParams.get('FORMAT'), 'image/jpeg')
  assert.equal(opaque.searchParams.get('TRANSPARENT'), 'FALSE')

  const clear = new URL(getMapUrl(berlin, 3857, [1, 2, 3, 4], 256, 256, { transparent: true }))
  assert.equal(clear.searchParams.get('FORMAT'), 'image/png')
  assert.equal(clear.searchParams.get('TRANSPARENT'), 'TRUE')
})

test('GetMap passes the bbox through unreordered', () => {
  const u = new URL(getMapUrl(berlin, 25833, [389862.1, 5819045.2, 389886, 5819062.9], 10, 10))
  assert.equal(u.searchParams.get('BBOX'), '389862.1,5819045.2,389886,5819062.9')
})

test('web-mercator tile bounds cover the world at zoom 0 and subdivide correctly', () => {
  const SPAN = 20037508.342789244
  const z0 = tileBBox3857(0, 0, 0)
  assert.ok(Math.abs(z0[0] + SPAN) < 1e-6 && Math.abs(z0[3] - SPAN) < 1e-6)

  // The four z1 tiles must tile the z0 tile exactly.
  const nw = tileBBox3857(1, 0, 0)
  const se = tileBBox3857(1, 1, 1)
  assert.ok(Math.abs(nw[0] - z0[0]) < 1e-6, 'north-west tile shares the west edge')
  assert.ok(Math.abs(nw[3] - z0[3]) < 1e-6, 'north-west tile shares the north edge')
  assert.ok(Math.abs(se[2] - z0[2]) < 1e-6 && Math.abs(se[1] - z0[1]) < 1e-6)
  assert.ok(Math.abs(nw[2] - se[0]) < 1e-6, 'tiles meet without a gap')
})

test('mercator inverse lands on the right place in Berlin', () => {
  // Round-trip a known tile centre: z17 over the Brandenburger Tor should come back near
  // 13.38 E, 52.52 N. This is the conversion the aerial route uses to decide which state's
  // WMS to ask, so an error here is served as a white image rather than as a failure.
  const b = tileBBox3857(17, 70406, 42987)
  const [lon, lat] = mercatorToLonLat((b[0] + b[2]) / 2, (b[1] + b[3]) / 2)
  assert.ok(Math.abs(lon - 13.3772) < 0.01, `lon was ${lon}`)
  assert.ok(Math.abs(lat - 52.5171) < 0.01, `lat was ${lat}`)
})

/**
 * `stateAt` resolves a coordinate against the extent of each state's indexed tiles.
 *
 * A stub pool rather than a database: what is being tested is the choice between overlapping
 * rectangles and the lifetime of the cache, neither of which needs PostGIS.
 */
function stubPool(rowsRef: { rows: Array<Record<string, unknown>>; queries: number }): pg.Pool {
  return {
    query: async () => {
      rowsRef.queries++
      return { rows: rowsRef.rows }
    },
  } as unknown as pg.Pool
}

const BRANDENBURG = { state: 'BB', min_lon: 11.2, min_lat: 51.3, max_lon: 14.8, max_lat: 53.6 }
const BERLIN = { state: 'BE', min_lon: 13.08, min_lat: 52.33, max_lon: 13.78, max_lat: 52.69 }

test('the nested state wins, whatever order the rows arrive in', async () => {
  // Berlin sits wholly inside Brandenburg, so this matters the moment a surrounding state is
  // indexed alongside it. First-match-wins would make the answer depend on the row order of
  // an unordered GROUP BY — and picking the wrong state is silent, because a WMS asked for
  // ground it does not hold returns a valid white image with 200 OK.
  resetStateBounds()
  const ref = { rows: [BRANDENBURG, BERLIN], queries: 0 }
  const pool = stubPool(ref)

  assert.equal(await stateAt(pool, 13.4, 52.52), 'BE', 'Brandenburger Tor is in Berlin')
  assert.equal(await stateAt(pool, 13.0, 52.9), 'BB', 'Oranienburg is in Brandenburg, not Berlin')

  // The same rows the other way round must give the same answers.
  resetStateBounds()
  const flipped = stubPool({ rows: [BERLIN, BRANDENBURG], queries: 0 })
  assert.equal(await stateAt(flipped, 13.4, 52.52), 'BE')
  assert.equal(await stateAt(flipped, 13.0, 52.9), 'BB')
})

test('a state indexed while the API runs appears without a restart', async () => {
  // The cache is right — this is consulted once per aerial tile — but it used to be kept for
  // the life of the process, so a freshly indexed state stayed invisible until someone
  // restarted the server.
  mock.timers.enable({ apis: ['Date'] })
  try {
    resetStateBounds()
    const ref = { rows: [{ state: 'BB', min_lon: 11.2, min_lat: 51.3, max_lon: 12.9, max_lat: 53.6 }], queries: 0 }
    const pool = stubPool(ref)

    assert.equal(await stateAt(pool, 13.4, 52.52), null, 'Berlin is not indexed yet')
    ref.rows = [...ref.rows, BERLIN]
    assert.equal(await stateAt(pool, 13.4, 52.52), null, 'still the cached answer')
    assert.equal(ref.queries, 1, 'and still one query')

    mock.timers.tick(61_000)
    assert.equal(await stateAt(pool, 13.4, 52.52), 'BE', 'visible once the cache expires')
    assert.equal(ref.queries, 2, 'exactly one refresh, so it is still a cache')
  } finally {
    mock.timers.reset()
  }
})

test('a cold cache under a burst of tiles issues one query', async () => {
  // An aerial pan asks for dozens of tiles at once, all of them missing the cache together.
  resetStateBounds()
  const ref = { rows: [BERLIN], queries: 0 }
  const pool = stubPool(ref)
  const answers = await Promise.all(Array.from({ length: 6 }, () => stateAt(pool, 13.4, 52.52)))
  assert.deepEqual(answers, Array(6).fill('BE'))
  assert.equal(ref.queries, 1)
})
