import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createReadStream } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { streamBuildings } from '../src/parser.ts'
import type { RawBuilding } from '../src/types.ts'

const fixture = (name: string) =>
  fileURLToPath(new URL(`../fixtures/${name}`, import.meta.url))

async function readAll(name: string) {
  const gen = streamBuildings(createReadStream(fixture(name), 'utf8'), { sourceTile: name })
  const out: RawBuilding[] = []
  let r = await gen.next()
  while (!r.done) {
    out.push(r.value)
    r = await gen.next()
  }
  return { buildings: out, summary: r.value }
}

test('parses the AdV LoD2 profile off a real CityGML 2.0 tile', async () => {
  const { buildings, summary } = await readAll('nrw-sample.gml')
  assert.equal(summary.buildings, 2)
  assert.equal(summary.parts, 2)
  assert.equal(summary.srsName, 'urn:adv:crs:ETRS89_UTM32*DE_DHHN2016_NH')
  assert.deepEqual(summary.otherLods, [], 'sample should contain only LoD2 geometry')
  assert.equal(buildings.length, 4)
})

test('reads attributes and codes verbatim, without interpreting them', async () => {
  const { buildings } = await readAll('nrw-sample.gml')
  const b = buildings.find((x) => x.gid === 'DENW43AL00001j2X')!
  assert.equal(b.functionCode, '31001_2460')
  assert.equal(b.roofTypeCode, '2100')
  assert.equal(b.measuredHeight, 2.961)
  assert.equal(b.creationDate, '2025-12-22')
  assert.equal(b.attributes.Gemeindeschluessel, '05370024')
  assert.equal(b.attributes.Grundrissaktualitaet, '2025-07-01')
  assert.equal(b.sourceTile, 'nrw-sample.gml')
})

test('geometry comes off boundedBy with rings closed and in source CRS', async () => {
  const { buildings } = await readAll('nrw-sample.gml')
  const b = buildings.find((x) => x.gid === 'DENW43AL00001j2X')!
  assert.equal(b.surfaces.length, 6)
  const ground = b.surfaces.find((s) => s.kind === 'ground')!
  const ring = ground.polygons[0]!.exterior
  assert.equal(ring.length, 15, '5 vertices x 3 ordinates, last repeating the first')
  assert.deepEqual(ring.slice(0, 3), ring.slice(12, 15), 'ring must be closed')
  assert.ok(ring[0]! > 280000 && ring[0]! < 281000, 'x should be a UTM32 easting inside the tile')
  assert.ok(ring[1]! > 5657000 && ring[1]! < 5658000, 'y should be a UTM32 northing inside the tile')
  assert.equal(b.terrainIntersection.length, 1)
})

test('BuildingParts are emitted separately, and their parent may hold no geometry at all', async () => {
  // DENW43AL00001j37 is the case that makes part handling non-optional: the parent
  // element carries the function code but zero surfaces. Merging or dropping parts
  // loses the entire building.
  const { buildings } = await readAll('nrw-sample.gml')
  const parent = buildings.find((x) => x.gid === 'DENW43AL00001j37')!
  const parts = buildings.filter((x) => x.parentGid === 'DENW43AL00001j37')

  assert.equal(parent.isPart, false)
  assert.equal(parent.surfaces.length, 0, 'parent carries no geometry of its own')
  assert.equal(parent.functionCode, '31001_2460', 'but it does carry the function code')

  assert.equal(parts.length, 2)
  for (const p of parts) {
    assert.equal(p.isPart, true)
    assert.ok(p.surfaces.length > 0, 'each part carries its own solid')
    assert.equal(p.functionCode, null, 'parts inherit function from the parent, not the file')
    assert.ok(p.measuredHeight! > 0)
  }
})

test('ClosureSurface is kept as its own kind, not folded into walls', async () => {
  const { buildings } = await readAll('nrw-sample.gml')
  const parts = buildings.filter((x) => x.isPart)
  for (const p of parts) {
    assert.equal(p.surfaces.filter((s) => s.kind === 'closure').length, 1)
  }
})

test('Berlin ships CityGML 1.0, and it reads the same as 2.0', async () => {
  // Most states publish version 2.0 — `nrw-sample.gml` is one of them. `nsOf` classifies by
  // namespace URI rather than by prefix or version, and this is the fixture that proves it
  // rather than asserting it in a comment: the file declares `citygml/building/1.0` throughout.
  const raw = await readFile(fixture('be-sample.gml'), 'utf8')
  assert.ok(raw.includes('citygml/building/1.0'), 'fixture must actually be CityGML 1.0')
  assert.ok(!raw.includes('citygml/building/2.0'))

  const { buildings, summary } = await readAll('be-sample.gml')
  assert.ok(buildings.length > 0)
  assert.equal(summary.srsName, 'urn:adv:crs:ETRS89_UTM33*DE_DHHN2016_NH')

  const b = buildings.find((x) => x.surfaces.length)!
  assert.ok(b.gid.startsWith('DEBE'), `expected a Berlin ALKIS id, got ${b.gid}`)
  const kinds = new Set(b.surfaces.map((s) => s.kind))
  assert.ok(kinds.has('wall') && kinds.has('roof') && kinds.has('ground'))
  assert.equal(typeof b.measuredHeight, 'number')
  assert.equal(b.roofTypeCode, '2100')
})

test('Berlin carries contact lines, so its ground warps without a terrain model', async () => {
  // 2,275 of 2,279 buildings in a central tile have one — which is why the ground surface
  // can be warped from the models themselves, with no terrain model wired up.
  const { buildings } = await readAll('be-sample.gml')
  const withGeometry = buildings.filter((b) => b.surfaces.length)
  const withCurve = withGeometry.filter((b) => b.terrainIntersection.length)
  assert.ok(withCurve.length > 0)
  // Flat xyz, and the heights must be plausible for Berlin rather than zero or a metre off.
  const ring = withCurve[0]!.terrainIntersection[0]!
  assert.equal(ring.length % 3, 0)
  for (let i = 2; i < ring.length; i += 3) {
    assert.ok(ring[i]! > 20 && ring[i]! < 130, `z ${ring[i]} is not a Berlin ground height`)
  }
})

test('Berlin publishes no addresses, and that is the source, not a parse failure', async () => {
  // Not one of 2,279 buildings in Berlin-Mitte carries an address; the CityGML has no
  // `bldg:address` element at all. Pinned so a future "addresses are broken" report can be
  // answered without re-deriving it — the fix is a spatial join against the Hauskoordinaten,
  // not a parser change.
  const raw = await readFile(fixture('be-sample.gml'), 'utf8')
  assert.ok(!raw.includes('bldg:address'))
  const { buildings } = await readAll('be-sample.gml')
  assert.ok(buildings.every((b) => b.address === null))
})
