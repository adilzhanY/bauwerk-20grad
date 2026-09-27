import { test } from 'node:test'
import assert from 'node:assert/strict'
import { BuildingDetailSchema, MeshSchema, VisionCornersSchema, VisionOpeningsSchema } from '../src/api.ts'

/** The smallest response the schema should accept. */
function detail(extra: Record<string, unknown> = {}) {
  return {
    buildingGid: 'DEBE_LOD2_1', state: 'BE', ags: null,
    functionCode: null, functionLabel: null, roofTypeCode: null, roofTypeLabel: null,
    creationDate: null, sourceTile: null, sourceTs: null, attribution: 'a',
    totals: {
      footprintArea: 1, roofArea3d: 1, roofAreaProjected: 1, wallArea: 1, volume: 1,
      ridgeHeight: null, eaveHeight: null, buriedDepth: null, buriedWallArea: null,
    },
    attributes: {}, parts: [], flags: [], orthophoto: null,
    ...extra,
  }
}

/** A complete orthophoto descriptor, shaped as `buildingDetail` assembles it. */
const ORTHO = {
  roof: { url: '/orthophoto?state=BE&bbox=1,2,3,4', bbox: [1, 2, 3, 4], widthPx: 300, heightPx: 300 },
  context: { url: '/orthophoto?state=BE&bbox=0,0,9,9', bbox: [0, 0, 9, 9], widthPx: 4000, heightPx: 4000 },
  epsg: 25833, gsdM: 0.2, trueOrtho: true, acquiredAt: '2026',
  attribution: 'Geoportal Berlin (TrueDOP20RGBI 2026)', licence: 'dl-de/zero-2-0',
}

test('a building with no imagery service is still a usable building', () => {
  // Imagery is per-service, not per-state, and a state can be indexed before its DOP is
  // wired up. That must cost the texture, not the building.
  const parsed = BuildingDetailSchema.parse(detail())
  assert.equal(parsed.orthophoto, null)
})

test('an orthophoto descriptor survives the round trip intact', () => {
  assert.deepEqual(BuildingDetailSchema.parse(detail({ orthophoto: ORTHO })).orthophoto, ORTHO)
})

test('an absent flight date parses as null rather than failing', () => {
  // The client and the server are deployed separately, so they are briefly out of step every
  // time either restarts. A service that will not state its vintage — and a server older than
  // the field — must cost the date, not the whole building.
  const { acquiredAt: _omitted, ...noDate } = ORTHO
  const parsed = BuildingDetailSchema.parse(detail({ orthophoto: noDate }))
  assert.equal(parsed.orthophoto?.acquiredAt, null)
})

test('a malformed image extent is still rejected', () => {
  // Tolerating absence must not become tolerating nonsense: the bbox *is* the whole UV
  // contract, so three numbers would drape the image in the wrong place rather than fail.
  const bad = { ...ORTHO, roof: { ...ORTHO.roof, bbox: [1, 2, 3] } }
  assert.throws(() => BuildingDetailSchema.parse(detail({ orthophoto: bad })))
})

test('a mesh without a contact line keeps the key absent rather than empty', () => {
  // The contact line is the only terrain information in the data, and not every source
  // publishes it. An absent key and an empty array are different claims, so a mesh without
  // one stays byte-identical to what it was before the field existed.
  const mesh = MeshSchema.parse({ origin: [0, 0, 0], surfaces: [] })
  assert.equal('terrain' in mesh, false)
})

test('a mesh with a contact line round-trips as flat xyz rings', () => {
  const terrain = [[0, 0, 34.2, 10, 0, 34.4, 10, 8, 34.5, 0, 8, 34.3, 0, 0, 34.2]]
  const mesh = MeshSchema.parse({ origin: [389000, 5819000, 0], terrain, surfaces: [] })
  assert.deepEqual(mesh.terrain, terrain)
})

test('a vision corners response parses, and a fifth corner is rejected', () => {
  const body = {
    width: 4284, height: 5712,
    corners: [[1069, 1097], [3235, 1168], [3339, 3393], [953, 3320]],
    baseHidden: 0.666, bottomFromVanishingPoint: false,
    facadeScore: 0.891, facadePrompt: 'building facade', seconds: 4.4,
    paintedPhoto: 'data:image/jpeg;base64,/9j/',
  }
  const parsed = VisionCornersSchema.parse(body)
  assert.equal(parsed.corners.length, 4)
  assert.throws(() => VisionCornersSchema.parse({ ...body, corners: [...body.corners, [0, 0]] }))
  assert.throws(() => VisionCornersSchema.parse({ ...body, baseHidden: 1.5 }))
})

test('vision openings are windows or doors in metres with a confidence', () => {
  const parsed = VisionOpeningsSchema.parse({
    openings: [{ kind: 'window', score: 0.957, x: 10.166, y: 11.604, width: 0.911, height: 1.556 }],
  })
  assert.equal(parsed.openings[0]!.kind, 'window')
  assert.throws(() => VisionOpeningsSchema.parse({ openings: [{ kind: 'gate', score: 0.5, x: 0, y: 0, width: 1, height: 1 }] }))
})
