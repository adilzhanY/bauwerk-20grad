import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { BuildingDetailSchema } from '../src/api.ts'
import {
  AGE_CLASSES,
  ageClassById,
  ageClassForYear,
  dominantAngle,
  editorRoof,
  estimateStoreys,
  isSimplePolygon,
  matchEdge,
  pitchFor,
  planFrameFor,
  polygonArea,
  ringToPlan,
  rowsOf,
  sharedEdges,
  signedArea,
  sourceValue,
  simplifyFootprint,
  squareCorners,
  storeyHeights,
  storeyOf,
  storeysFromOpenings,
  surveyToBauwerk,
  germanNote,
  germanText,
  SURVEY_DE,
  toMesh,
  toPlan,
  unionLength,
  utmToLatLon,
  type BauwerkBuilding,
  type SurveyInput,
  type Vec2,
} from '../src/survey/index.ts'

const near = (a: number, b: number, eps = 1e-6) => Math.abs(a - b) <= eps
const SAMPLES = ['DEBE02YY40000BOo', 'DEBE02YY40000Atr', 'DEBE02YY400000kY'] as const

function fixture(gid: string): SurveyInput {
  const building = BuildingDetailSchema.parse(JSON.parse(readFileSync(`fixtures/buildings/${gid}.json`, 'utf8')))
  const survey = JSON.parse(readFileSync(`fixtures/surveys/${gid}.json`, 'utf8'))
  const neighbours = JSON.parse(readFileSync(`fixtures/neighbours/${gid}.json`, 'utf8'))
  return {
    building,
    partGid: survey.partGid,
    utmZone: 33,
    neighbours,
    facts: { ageClass: 'bis1918', ageClassConfirmed: false },
    walls: [{ surfaceIndex: survey.surfaceIndex, openings: survey.openings, method: 'detected', photo: survey.photo }],
  }
}

function build(gid: string, change: (input: SurveyInput) => SurveyInput = (i) => i) {
  const result = surveyToBauwerk(change(fixture(gid)))
  assert.ok(result.ok, result.ok ? '' : result.reason)
  return result
}

// ---------------------------------------------------------------- footprint

const square = (size: number): Vec2[] => [{ x: 0, y: 0 }, { x: size, y: 0 }, { x: size, y: size }, { x: 0, y: size }]

test('a ground ring becomes a counter-clockwise outline without its closing vertex', () => {
  const clockwise = [0, 0, 0, 0, 5, 0, 5, 5, 0, 5, 0, 0, 0, 0, 0]
  const plan = ringToPlan(clockwise)
  assert.equal(plan.length, 4)
  assert.ok(signedArea(plan) > 0)
})

test('simplification removes straight corners and slivers but keeps the area within a percent', () => {
  const noisy: Vec2[] = [
    { x: 0, y: 0 }, { x: 5, y: 0.01 }, { x: 10, y: 0 }, { x: 10, y: 0.1 }, { x: 10.05, y: 0.12 },
    { x: 10, y: 10 }, { x: 0, y: 10 }, { x: 0, y: 10.02 },
  ]
  const clean = simplifyFootprint(noisy)
  assert.ok(clean.length <= 5, `kept ${clean.length} vertices`)
  assert.ok(Math.abs(polygonArea(clean) - polygonArea(noisy)) / polygonArea(noisy) <= 0.01)
  assert.ok(isSimplePolygon(clean))
})

test('every sample part simplifies to a simple polygon within one percent of its area', () => {
  for (const gid of SAMPLES) {
    const { building } = fixture(gid)
    for (const part of building.parts) {
      const ground = part.mesh?.surfaces.find((s) => s.kind === 'ground')?.rings[0]
      if (!ground) continue
      const raw = ringToPlan(ground)
      const clean = simplifyFootprint(raw)
      assert.ok(isSimplePolygon(clean), `${part.gid} is not simple`)
      assert.ok(Math.abs(polygonArea(clean) - polygonArea(raw)) / polygonArea(raw) <= 0.01, part.gid)
    }
  }
})

test('the dominant angle follows the long walls, modulo 90 degrees', () => {
  const angle = (20 * Math.PI) / 180
  const turned = square(10).map((p) => ({ x: p.x * Math.cos(angle) - p.y * Math.sin(angle), y: p.x * Math.sin(angle) + p.y * Math.cos(angle) }))
  assert.ok(near(dominantAngle(turned), angle, 1e-9))
})

test('the plan frame lays the walls on the axes and gives the bearing of plan +y', () => {
  // A square turned 20 degrees counter-clockwise from east: plan +y then points 20 degrees
  // west of north, a bearing of 340.
  const angle = (20 * Math.PI) / 180
  const turned = square(10).map((p) => ({ x: p.x * Math.cos(angle) - p.y * Math.sin(angle), y: p.x * Math.sin(angle) + p.y * Math.cos(angle) }))
  const frame = planFrameFor(turned)
  const plan = turned.map((p) => toPlan(frame, p))
  for (let i = 0; i < 4; i++) {
    const a = plan[i]!
    const b = plan[(i + 1) % 4]!
    assert.ok(near(a.x, b.x, 1e-9) || near(a.y, b.y, 1e-9), 'edge not on an axis')
  }
  assert.ok(near(frame.bearing, 340, 1e-6), `bearing ${frame.bearing}`)
  const back = toMesh(frame, plan[2]!)
  assert.ok(near(back.x, turned[2]!.x, 1e-9) && near(back.y, turned[2]!.y, 1e-9))
})

test('corners within a few degrees of square become square', () => {
  const almost: Vec2[] = [{ x: 0, y: 0 }, { x: 10, y: 0.2 }, { x: 10, y: 8 }, { x: -0.1, y: 8 }]
  const squared = squareCorners(almost)
  assert.ok(squared)
  for (let i = 0; i < squared.length; i++) {
    const a = squared[i]!
    const b = squared[(i + 1) % squared.length]!
    assert.ok(near(a.x, b.x) || near(a.y, b.y))
  }
})

// ---------------------------------------------------------------- storeys

test('storeys are estimated from the eave height and split evenly', () => {
  assert.equal(estimateStoreys(14.6, 3.1), 5)
  assert.equal(estimateStoreys(1, 3.1), 1)
  assert.deepEqual(storeyHeights(9, 3), [3, 3, 3])
})

test('an opening belongs to the storey that holds most of it', () => {
  const heights = [3, 3, 3]
  assert.equal(storeyOf(0.9, 2.5, heights), 0)
  assert.equal(storeyOf(3.8, 5.4, heights), 1)
  // Starts just below the second floor but reaches far into it.
  assert.equal(storeyOf(2.8, 4.9, heights), 1)
})

test('openings with overlapping heights form one row', () => {
  const rows = rowsOf([{ bottom: 0, top: 2.5 }, { bottom: 1, top: 2.6 }, { bottom: 4, top: 5.6 }])
  assert.equal(rows.length, 2)
  assert.deepEqual(rows[0], { bottom: 0, top: 2.6 })
})

test('storeys come from the window rows, with floors halfway between rows', () => {
  const spans = [
    { bottom: 0, top: 2.4 }, { bottom: 0.9, top: 2.6 }, // ground floor: a door and a window
    { bottom: 3.9, top: 5.6 }, // first floor
    { bottom: 7.0, top: 8.7 }, // second floor
    { bottom: 0.05, top: 0.6 }, // a basement grille, ignored
  ]
  const heights = storeysFromOpenings(spans, 10)
  assert.ok(heights)
  assert.equal(heights.length, 3)
  assert.ok(near(heights[0]!, 3.25, 1e-9))
  assert.ok(near(heights.reduce((s, h) => s + h, 0), 10, 0.02))
  // One row says nothing.
  assert.equal(storeysFromOpenings([{ bottom: 1, top: 2.5 }], 10), null)
})

// ---------------------------------------------------------------- roof

test('roof codes map to the editor kinds, with a note when simplified', () => {
  const rect = square(10).map((p) => ({ x: p.x * 1.5, y: p.y }))
  assert.equal(editorRoof('1000', 0, rect).kind, 'flat')
  assert.equal(editorRoof('3100', 4, rect).kind, 'gable')
  assert.equal(editorRoof('3200', 4, rect).kind, 'hip')
  const lShape: Vec2[] = [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 5 }, { x: 5, y: 5 }, { x: 5, y: 10 }, { x: 0, y: 10 }]
  const hipOnL = editorRoof('3200', 4, lShape)
  assert.equal(hipOnL.kind, 'gable')
  assert.ok(hipOnL.note)
  assert.equal(editorRoof('5000', 4, rect).kind, 'gable')
  assert.equal(editorRoof('2100', 1, rect).note, 'Pultdach als Flachdach vereinfacht')
  assert.deepEqual(editorRoof('2100', 1, rect).messages, [{ key: 'survey.roof.flatSimplified', values: { roofType: '2100' } }])
  assert.deepEqual(editorRoof('5000', 4, rect).messages, [{ key: 'survey.roof.mixedAsGable' }])
  // The ridge runs along the longer side.
  assert.equal(editorRoof('3100', 4, rect).ridgeAxis, 'x')
})

test('pitch comes from the rise over half the span', () => {
  assert.ok(near(pitchFor(5, 10), 45, 0.05))
  assert.equal(pitchFor(0, 10), 0)
  assert.equal(pitchFor(50, 2), 60)
})

// ---------------------------------------------------------------- edges and shared walls

test('a wall matches the footprint edge it stands on, not a parallel one across the house', () => {
  const box = square(10)
  assert.equal(matchEdge({ x: 1, y: 0.2 }, { x: 9, y: 0.2 }, box), 0)
  assert.equal(matchEdge({ x: 9, y: 10.1 }, { x: 1, y: 10.1 }, box), 2)
  // Running the wrong way round: the inside face of a wall, not an outside wall.
  assert.equal(matchEdge({ x: 9, y: 0 }, { x: 1, y: 0 }, box), null)
})

test('interval lengths are counted once where they overlap', () => {
  assert.ok(near(unionLength([[0, 4], [3, 6], [8, 9]]), 7))
})

test('a wall against a neighbour is shared, a free wall is not', () => {
  const house = square(10)
  const neighbour = square(10).map((p) => ({ x: p.x + 10.1, y: p.y }))
  const shared = sharedEdges(house, [neighbour])
  assert.deepEqual(shared.map((s) => s.edge), [1])
  assert.deepEqual(sharedEdges(house, []), [])
})

test('BOo and Atr share their party wall', () => {
  const boo = build('DEBE02YY40000BOo').file.building
  const atr = build('DEBE02YY40000Atr').file.building
  assert.ok(boo.sharedEdges.length >= 1)
  assert.ok(atr.sharedEdges.length >= 1)
})

// ---------------------------------------------------------------- age classes and UTM

test('the age classes carry the table values of the 2020 Bekanntmachung', () => {
  assert.equal(AGE_CLASSES.length, 9)
  const old = ageClassById('bis1918')
  assert.deepEqual(old.u, { wall: 1.5, roof: 2.6, floor: 1.2, window: 2.7, door: 2.9 })
  assert.deepEqual(ageClassById('1969-1978').u, { wall: 1.0, roof: 0.8, floor: 1.0, window: 2.7, door: 2.9 })
  assert.deepEqual(ageClassById('ab2002').u, { wall: 0.4, roof: 0.2, floor: 0.5, window: 1.5, door: 2.9 })
  assert.equal(ageClassForYear(1905), 'bis1918')
  assert.equal(ageClassForYear(1918), 'bis1918')
  assert.equal(ageClassForYear(1960), '1958-1968')
  assert.equal(ageClassForYear(2010), 'ab2002')
})

test('UTM zone 33 back to latitude and longitude matches PROJ to a few millimetres', () => {
  // Forward values from pyproj, EPSG:25833 (the same reference points Bauwerk tests against).
  const cases: [number, number, number, number][] = [
    [389918.0415, 5819699.1323, 52.516275, 13.377704],
    [500000.0, 5816652.0063, 52.5, 15],
    [296374.8298, 5820882.9785, 52.5, 12],
  ]
  for (const [e, n, lat, lon] of cases) {
    const p = utmToLatLon(e, n, 33)
    assert.ok(near(p.lat, lat, 1e-7) && near(p.lon, lon, 1e-7), `${p.lat} ${p.lon}`)
  }
})

test('a door a few steps above the street stays a door, on the floor at its measured height', () => {
  // BOo's two doors as marked in the photo editor: the photo's bottom edge sits a little above
  // the street, so their bottoms land 0.34 m and 0.39 m above the ground floor. A third "door"
  // high on the wall is a window that reaches low.
  const doors = [
    { kind: 'door' as const, x: 5.633, y: 0.092, width: 1.254, height: 2.685 },
    { kind: 'door' as const, x: 12.036, y: 0.142, width: 0.944, height: 1.957 },
    { kind: 'door' as const, x: 2, y: 5.5, width: 1, height: 2 },
  ]
  const result = build('DEBE02YY40000BOo', (input) => ({ ...input, walls: [{ ...input.walls[0]!, openings: doors }] }))
  const openings = result.file.building.storeys.flatMap((s) => s.openings)
  const kept = openings.filter((o) => o.kind === 'door').sort((a, b) => a.offset - b.offset)
  assert.equal(kept.length, 2)
  assert.deepEqual(kept.map((o) => [o.sill, o.width, o.height]), [[0, 1.254, 2.685], [0, 0.944, 1.957]])
  assert.equal(openings.filter((o) => o.kind === 'window').length, 1)
  assertEditorValid(result.file.building)
})

// ---------------------------------------------------------------- the whole file

/** The rules Bauwerk's importer checks for every opening. */
function assertEditorValid(b: BauwerkBuilding) {
  assert.ok(signedArea(b.footprint) > 0, 'footprint must be counter-clockwise')
  assert.ok(isSimplePolygon(b.footprint), 'footprint must be simple')
  assert.ok(b.origin.rotation >= 0 && b.origin.rotation < 360)
  const ids = new Set<string>()
  b.storeys.forEach((storey) => {
    for (const o of storey.openings) {
      assert.ok(!ids.has(o.id), `duplicate id ${o.id}`)
      ids.add(o.id)
      const a = b.footprint[o.wallIndex]!
      const c = b.footprint[(o.wallIndex + 1) % b.footprint.length]!
      const length = Math.hypot(c.x - a.x, c.y - a.y)
      assert.ok(o.offset >= 0 && o.offset + o.width <= length + 1e-9, `${o.id} leaves its wall`)
      assert.ok(o.sill >= 0 && o.sill + o.height <= storey.height + 1e-9, `${o.id} leaves its storey`)
      assert.ok(o.width >= 0.1 && o.height >= 0.1, `${o.id} too small`)
      if (o.kind === 'door') assert.equal(o.sill, 0)
      for (const other of storey.openings) {
        if (other === o || other.wallIndex !== o.wallIndex) continue
        const overlap = o.offset < other.offset + other.width - 1e-6 && other.offset < o.offset + o.width - 1e-6
        assert.ok(!overlap, `${o.id} overlaps ${other.id}`)
      }
      assert.ok(!b.sharedEdges.includes(o.wallIndex), `${o.id} sits on a shared wall`)
    }
  })
}

for (const gid of SAMPLES) {
  test(`${gid} becomes a Bauwerk building the editor accepts`, () => {
    const { file, report } = build(gid)
    assert.equal(file.format, 'bauwerk')
    assertEditorValid(file.building)
    assert.ok(report.openingCount > 0)
    for (const storey of file.building.storeys) {
      for (const o of storey.openings) assert.equal(file.building.sources[`opening:${o.id}`]?.kind, 'photo')
    }
  })
}

test('BOo keeps its street openings and their area within ten percent', () => {
  const { report } = build('DEBE02YY40000BOo')
  const measured = fixture('DEBE02YY40000BOo').walls[0]!.openings
  const area = measured.reduce((s, o) => s + o.width * o.height, 0)
  assert.ok(report.openingCount >= 24, `${report.openingCount} openings`)
  assert.ok(Math.abs(report.openingArea - area) / area < 0.1, `${report.openingArea} against ${area}`)
})

test('the same input gives the same ids, so a second export updates the first', () => {
  const a = build('DEBE02YY40000BOo').file.building
  const b = build('DEBE02YY40000BOo').file.building
  assert.deepEqual(a.storeys.flatMap((s) => s.openings.map((o) => o.id)), b.storeys.flatMap((s) => s.openings.map((o) => o.id)))
})

test('a typed storey count wins over the photo, with a warning when they disagree', () => {
  const result = build('DEBE02YY40000BOo', (input) => ({ ...input, facts: { ...input.facts, storeys: 6 } }))
  assert.equal(result.file.building.storeys.length, 6)
  assert.equal(result.file.building.sources.storeys?.kind, 'typed')
  assert.ok(result.report.warnings.some((w) => w.key === 'survey.warning.storeyMismatch'))
})

test('without photos the storeys are estimated and the model has no windows', () => {
  const result = build('DEBE02YY40000BOo', (input) => ({ ...input, walls: [] }))
  assert.equal(result.file.building.sources.storeys?.kind, 'estimate')
  assert.equal(result.report.openingCount, 0)
  assert.ok(result.report.warnings.some((w) => w.key === 'survey.warning.noPhoto'))
})

test('the age class sets the constructions and says when it was assumed', () => {
  const guessed = build('DEBE02YY40000BOo')
  assert.ok(guessed.report.warnings.some((w) => w.key === 'survey.warning.ageClassAssumed'))
  const typed = build('DEBE02YY40000BOo', (input) => ({ ...input, facts: { ageClass: '1969-1978', ageClassConfirmed: true } }))
  assert.equal(typed.file.building.constructions.find((c) => c.category === 'wall')?.uValue, 1.0)
  assert.ok(!typed.report.warnings.some((w) => w.key === 'survey.warning.ageClassAssumed'))
})

test('every source carries the value it was written with', () => {
  const b = build('DEBE02YY40000BOo').file.building
  for (const path of ['footprint', 'storeys', 'roof', 'constructions', 'sharedEdges']) {
    assert.deepEqual(b.sources[path]?.value, sourceValue(b, path), path)
  }
  const first = b.storeys.flatMap((s) => s.openings)[0]!
  assert.deepEqual(b.sources[`opening:${first.id}`]?.value, [first.wallIndex, first.kind, first.offset, first.width, first.height, first.sill])
  assert.equal(sourceValue(b, 'opening:missing'), null)
})

test('a part without geometry is refused with a reason', () => {
  const result = surveyToBauwerk({ ...fixture('DEBE02YY400000kY'), partGid: 'DEBE02YY400000kY' })
  assert.equal(result.ok, false)
  if (!result.ok) {
    assert.deepEqual(result.message, { key: 'survey.failed.noGeometry' })
    assert.equal(result.reason, 'Dieser Gebäudeteil hat keine Geometrie.')
  }
})

test('every note and warning carries its message key, and the German note is the same text', () => {
  const result = build('DEBE02YY40000BOo', (input) => ({ ...input, walls: [], fillMissingWindows: true }))
  const { sources } = result.file.building
  const keys = (path: string) => sources[path]?.messages?.map((m) => m.key)
  assert.deepEqual(keys('constructions'), ['survey.constructions.assumed'])
  assert.deepEqual(sources.constructions?.messages?.[0]?.values, { ageClass: 'bis1918' })
  assert.deepEqual(keys('storeys'), ['survey.storeys.estimated'])
  const storeys = sources.storeys!.messages![0]!.values!
  assert.equal(storeys.count, result.file.building.storeys.length)
  assert.equal(storeys.height, Math.round(result.report.eaveAboveStreet * 100) / 100)
  assert.deepEqual(keys('footprint'), ['survey.footprint'])
  assert.equal(sources.footprint?.messages?.[0]?.values?.corners, result.file.building.footprint.length)
  assert.deepEqual(keys('sharedEdges'), ['survey.sharedEdges'])
  assert.equal(keys('roof')?.[0]?.startsWith('survey.roof.'), true)
  const catalogue = Object.entries(sources).find(([path]) => path.startsWith('opening:'))?.[1]
  assert.deepEqual(catalogue?.messages, [{ key: 'survey.opening.catalogue' }])
  for (const [path, source] of Object.entries(sources)) {
    assert.ok(source.messages?.length, path)
    assert.equal(source.note, germanNote(source.messages!), path)
  }
  assert.deepEqual(result.report.warnings.map((w) => w.key).sort(), ['survey.warning.ageClassAssumed', 'survey.warning.noPhoto'])
  assert.equal(germanText(result.report.warnings.find((w) => w.key === 'survey.warning.ageClassAssumed')!), 'Baualtersklasse nicht angegeben: bis 1918 angenommen.')
})

test('the German notes read as before', () => {
  assert.equal(
    germanText({ key: 'survey.storeys.estimated', values: { count: 5, height: 14.63 } }),
    '5 Geschosse aus 14,63 m Traufhöhe über Straße geschätzt',
  )
  assert.equal(germanNote([{ key: 'survey.roof.type', values: { roofType: '5000' } }, { key: 'survey.roof.mixedAsGable' }]), 'Mischform; Mischform als Satteldach vereinfacht')
  assert.equal(germanText({ key: 'survey.constructions', values: { ageClass: '1969-1978' } }), 'Pauschalwerte 1969 bis 1978, Bekanntmachung Datenaufnahme Wohngebäudebestand vom 8.10.2020')
  assert.equal(AGE_CLASSES[0]!.names.wall, SURVEY_DE['survey.construction.oldWall'])
})

test('photographed openings say how they were found, as keys', () => {
  const b = build('DEBE02YY40000BOo').file.building
  const photo = Object.entries(b.sources).filter(([path]) => path.startsWith('opening:')).map(([, s]) => s)
  assert.ok(photo.length > 0)
  for (const source of photo) {
    assert.ok(['survey.opening.detected', 'survey.opening.detectedScore'].includes(source.messages![0]!.key))
    for (const m of source.messages!.slice(1)) assert.ok(m.key.startsWith('survey.opening.'), m.key)
  }
})

test('facades without a photo get the default windows when asked, party walls none', () => {
  const plain = build('DEBE02YY40000BOo').file.building
  const filled = build('DEBE02YY40000BOo', (input) => ({ ...input, fillMissingWindows: true }))
  const b = filled.file.building
  assert.ok(filled.report.catalogueOpenings > 0)
  const count = (x: BauwerkBuilding) => x.storeys.reduce((n, s) => n + s.openings.length, 0)
  assert.equal(count(b), count(plain) + filled.report.catalogueOpenings)
  assertEditorValid(b)
  const catalogue = b.storeys.flatMap((s) => s.openings).filter((o) => o.id.startsWith('c'))
  for (const o of catalogue) {
    assert.ok(!b.sharedEdges.includes(o.wallIndex), 'a party wall got a window')
    assert.equal(b.sources[`opening:${o.id}`]?.kind, 'catalogue')
  }
  // The photographed street wall keeps its measured windows only.
  const photographedEdge = plain.storeys.flatMap((s) => s.openings)[0]!.wallIndex
  assert.ok(!catalogue.some((o) => o.wallIndex === photographedEdge))
})

test('an entrance found in parts becomes one door, never a door with a strip beside it', () => {
  const result = build('DEBE02YY40000BOo')
  for (const storey of result.file.building.storeys) {
    for (const o of storey.openings) {
      for (const other of storey.openings) {
        if (other === o || other.wallIndex !== o.wallIndex || other.kind !== o.kind) continue
        const apart = Math.max(other.offset - (o.offset + o.width), o.offset - (other.offset + other.width))
        assert.ok(apart > 0.05, `${o.id} and ${other.id} touch: one opening in two pieces`)
      }
    }
  }
  // BOo's east entrance: the door, its sidelight and the transom over them, as one door.
  const ground = result.file.building.storeys[0]!
  const entrance = ground.openings.filter((o) => o.kind === 'door' && o.offset > 11)
  assert.equal(entrance.length, 1)
  assert.ok(entrance[0]!.width > 1.2, String(entrance[0]!.width))
})
