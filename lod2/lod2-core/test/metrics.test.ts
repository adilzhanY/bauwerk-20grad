import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createReadStream } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { streamBuildings } from '../src/parser.ts'
import { computeMetrics, buildMesh, footprintPolygons, footprintWkt, classifySurfaces } from '../src/metrics.ts'
import type { RawBuilding } from '../src/types.ts'

async function readAll(name: string) {
  const url = fileURLToPath(new URL(`../fixtures/${name}`, import.meta.url))
  const gen = streamBuildings(createReadStream(url, 'utf8'))
  const out: RawBuilding[] = []
  let r = await gen.next()
  while (!r.done) {
    out.push(r.value)
    r = await gen.next()
  }
  return out
}

test('computed ridge height agrees with the source measuredHeight', async () => {
  // This is the cross-check against the publisher's own number: if our ground plane or
  // roof extraction were wrong, these would diverge.
  const buildings = await readAll('nrw-sample.gml')
  const withGeom = buildings.filter((b) => b.surfaces.length > 0 && b.measuredHeight !== null)
  assert.ok(withGeom.length >= 3)
  for (const b of withGeom) {
    const m = computeMetrics(b)
    assert.ok(
      Math.abs(m.ridgeHeight! - b.measuredHeight!) < 0.01,
      `${b.gid}: computed ridge ${m.ridgeHeight} vs measured ${b.measuredHeight}`,
    )
    assert.ok(!m.flags.includes('height-mismatch'))
  }
})

test('a simple shed-roofed building measures up', async () => {
  const buildings = await readAll('nrw-sample.gml')
  const b = buildings.find((x) => x.gid === 'DENW43AL00001j2X')!
  const m = computeMetrics(b)

  assert.ok(Math.abs(m.footprintArea - 34.88) < 0.01)
  assert.ok(Math.abs(m.volume - 93.07) < 0.01)
  assert.deepEqual(m.flags, [], 'clean building should carry no flags')

  // This building is a prism — a flat quadrilateral roof over a flat base — so its
  // volume is exactly footprint x mean height. Held to 0.01% because anything looser
  // hides orientation bugs in the volume integration.
  const meanHeight = (m.eaveHeight! + m.ridgeHeight!) / 2
  assert.ok(
    Math.abs(m.volume - m.footprintArea * meanHeight) / m.volume < 1e-4,
    `volume ${m.volume} vs footprint*meanHeight ${m.footprintArea * meanHeight}`,
  )

  assert.equal(m.roofPlanes.length, 1)
  assert.ok(m.roofPlanes[0]!.area3d >= m.roofPlanes[0]!.areaProjected, '3D area >= its projection')
})

test('closure surfaces count toward the solid but never toward wall area', async () => {
  const buildings = await readAll('nrw-sample.gml')
  const part = buildings.find((b) => b.isPart)!
  const m = computeMetrics(part)

  assert.equal(m.surfaceCounts.closure, 1)
  assert.ok(!m.flags.includes('solid-not-closed'), 'closure surface should make the solid watertight')

  const closurePolys = part.surfaces.filter((s) => s.kind === 'closure').flatMap((s) => s.polygons)
  assert.ok(closurePolys.length > 0)
  // Recompute wall area directly and confirm the closure face is absent from it.
  const wallOnly = part.surfaces.filter((s) => s.kind === 'wall').flatMap((s) => s.polygons)
  assert.equal(m.surfaceCounts.wall, wallOnly.length)
  assert.ok(m.wallArea > 0)
})

test('a building with no geometry of its own is flagged, not silently zeroed', async () => {
  const buildings = await readAll('nrw-sample.gml')
  const parent = buildings.find((b) => b.gid === 'DENW43AL00001j37')!
  const m = computeMetrics(parent)
  assert.deepEqual(m.flags, ['no-geometry'])
  assert.equal(m.volume, 0)
})

test('roof plane areas sum to the reported roof area', async () => {
  const buildings = await readAll('nrw-sample.gml')
  for (const b of buildings.filter((x) => x.surfaces.length)) {
    const m = computeMetrics(b)
    const sum = m.roofPlanes.reduce((s, p) => s + p.area3d, 0)
    assert.ok(Math.abs(sum - m.roofArea3d) < 1e-6)
  }
})

test('mesh rebases to a local origin and stays reconstructible', async () => {
  const buildings = await readAll('nrw-sample.gml')
  const b = buildings.find((x) => x.gid === 'DENW43AL00001j2X')!
  const mesh = buildMesh(b)

  assert.ok(mesh.origin[0] > 280000 && mesh.origin[1] > 5657000, 'origin stays in source CRS')
  const coords = mesh.surfaces.flatMap((s) => s.rings.flat())
  assert.ok(coords.every((v) => Math.abs(v) < 1000), 'rebased coordinates are small and metric')

  // Adding the origin back must land on the original ground ring.
  const meshGround = mesh.surfaces.find((s) => s.kind === 'ground')!.rings[0]!
  const srcGround = b.surfaces.find((s) => s.kind === 'ground')!.polygons[0]!.exterior
  for (let i = 0; i < srcGround.length; i++) {
    assert.ok(Math.abs(meshGround[i]! + mesh.origin[i % 3]! - srcGround[i]!) < 1e-6)
  }
})

test('footprint falls back to the terrain intersection when GroundSurface is missing', async () => {
  const buildings = await readAll('nrw-sample.gml')
  const b = buildings.find((x) => x.gid === 'DENW43AL00001j2X')!
  assert.equal(footprintPolygons(b).length, 1)

  const stripped: RawBuilding = { ...b, surfaces: b.surfaces.filter((s) => s.kind !== 'ground') }
  const polys = footprintPolygons(stripped)
  assert.equal(polys.length, 1, 'should fall back to lod2TerrainIntersection')
  assert.ok(polys[0]!.exterior.length >= 12)
})

test('geometry without semantic surfaces is classified by normal direction', async () => {
  const buildings = await readAll('nrw-sample.gml')
  const b = buildings.find((x) => x.gid === 'DENW43AL00001j2X')!
  const loose = [{ id: null, kind: 'unknown' as const, polygons: b.surfaces.flatMap((s) => s.polygons) }]
  const classified = classifySurfaces(loose)
  const kinds = Object.fromEntries(classified.map((s) => [s.kind, s.polygons.length]))
  assert.equal(kinds.wall, 4)
  assert.equal(kinds.roof, 1)
  assert.equal(kinds.ground, 1)
})

test('footprint WKT is closed, 2D, and in the source CRS', () => {
  // Built inline rather than from the fixture so the expected string is obvious.
  const b = {
    surfaces: [{ id: null, kind: 'ground' as const, polygons: [{
      exterior: [0, 0, 5, 10, 0, 5, 10, 10, 5, 0, 10, 5, 0, 0, 5],
      interiors: [[4, 4, 5, 6, 4, 5, 6, 6, 5, 4, 6, 5, 4, 4, 5]],
    }] }],
    terrainIntersection: [],
  } as unknown as RawBuilding
  assert.equal(
    footprintWkt(b),
    'MULTIPOLYGON(((0 0,10 0,10 10,0 10,0 0),(4 4,6 4,6 6,4 6,4 4)))',
  )
})

test('footprint WKT is null when there is no ground geometry', () => {
  const b = { surfaces: [], terrainIntersection: [] } as unknown as RawBuilding
  assert.equal(footprintWkt(b), null)
})

test('the terrain-intersection curve survives into the mesh, rebased with it', async () => {
  // It used to be parsed and dropped. The viewer needs it in the same frame as the geometry,
  // so it rides inside the mesh rather than in a column of its own.
  const buildings = await readAll('nrw-sample.gml')
  const withCurve = buildings.find((b) => b.terrainIntersection.length > 0)
  assert.ok(withCurve, 'the fixture should contain a building with a terrain curve')

  const mesh = buildMesh(withCurve)
  assert.ok(mesh.terrain, 'mesh should carry the curve')
  assert.equal(mesh.terrain!.length, withCurve.terrainIntersection.length)

  // Same origin as the geometry: a curve rebased differently would sit metres off the walls.
  // Collinear vertices are dropped on the way, so this checks the curve rather than the list:
  // every point kept is a source point, and every source point still lies on the result.
  const source = withCurve.terrainIntersection[0]!
  const rebased = mesh.terrain![0]!
  const shifted: number[] = []
  for (let i = 0; i + 2 < source.length; i += 3) {
    shifted.push(source[i]! - mesh.origin[0], source[i + 1]! - mesh.origin[1], source[i + 2]! - mesh.origin[2])
  }

  for (let i = 0; i + 2 < rebased.length; i += 3) {
    const onSource = Array.from({ length: shifted.length / 3 }, (_, j) =>
      Math.hypot(rebased[i]! - shifted[j * 3]!, rebased[i + 1]! - shifted[j * 3 + 1]!, rebased[i + 2]! - shifted[j * 3 + 2]!))
    assert.ok(Math.min(...onSource) < 1e-3, 'every kept vertex is a source vertex, to the millimetre it was rounded to')
  }

  for (let j = 0; j + 2 < shifted.length; j += 3) {
    let best = Infinity
    for (let i = 0; i + 5 < rebased.length; i += 3) {
      best = Math.min(best, segmentDistance(shifted, j, rebased, i))
    }
    assert.ok(best < 0.021, `source vertex ${j / 3} drifted ${best.toFixed(4)} m from the simplified curve`)
  }
})

/** Distance from vertex `j` of `p` to the segment starting at `i` of `q`. */
function segmentDistance(p: readonly number[], j: number, q: readonly number[], i: number): number {
  const ex = q[i + 3]! - q[i]!, ey = q[i + 4]! - q[i + 1]!, ez = q[i + 5]! - q[i + 2]!
  const len2 = ex * ex + ey * ey + ez * ez
  const t = len2 === 0 ? 0 : Math.min(1, Math.max(0,
    ((p[j]! - q[i]!) * ex + (p[j + 1]! - q[i + 1]!) * ey + (p[j + 2]! - q[i + 2]!) * ez) / len2))
  return Math.hypot(p[j]! - (q[i]! + t * ex), p[j + 1]! - (q[i + 1]! + t * ey), p[j + 2]! - (q[i + 2]! + t * ez))
}

test('a building with no curve omits the key rather than sending an empty one', async () => {
  // Not every source publishes one. Omitting the key rather than sending an empty array is
  // what lets the viewer distinguish "no data" from "flat ground".
  const buildings = await readAll('nrw-sample.gml')
  const noCurve = buildings.find((b) => b.surfaces.length > 0 && b.terrainIntersection.length === 0)
  if (!noCurve) return
  assert.equal(buildMesh(noCurve).terrain, undefined)
  assert.ok(computeMetrics(noCurve).flags.includes('no-terrain-curve'))
  assert.equal(computeMetrics(noCurve).buriedDepth, null)
})

test('buried depth and buried wall area measure the ground climbing the walls', () => {
  // A 10 x 10 m building whose floor is at 100 m, with the ground level along two sides and
  // 2 m up the other two. Buried wall is then two walls x 10 m x the mean rise along them.
  const slab = 100
  const ring = (z: (x: number, y: number) => number) => {
    const pts: Array<[number, number]> = [[0, 0], [10, 0], [10, 10], [0, 10], [0, 0]]
    return pts.flatMap(([x, y]) => [x, y, z(x, y)])
  }
  const building: RawBuilding = {
    gid: 'x', parentGid: null, isPart: false, creationDate: null, functionCode: null,
    roofTypeCode: null, measuredHeight: null, storeysAboveGround: null, storeysBelowGround: null,
    attributes: {}, address: null, srsName: null, sourceTile: null,
    surfaces: [{
      id: 'g', kind: 'ground',
      polygons: [{ exterior: [0, 0, slab, 10, 0, slab, 10, 10, slab, 0, 10, slab, 0, 0, slab], interiors: [] }],
    }],
    terrainIntersection: [ring((_x, y) => slab + (y === 10 ? 2 : 0))],
  } as unknown as RawBuilding

  const m = computeMetrics(building)
  assert.equal(m.buriedDepth, 2, 'the ground reaches 2 m up the high side')
  // Sides: (0,0)->(10,0) flat = 0; (10,0)->(10,10) mean rise 1 m over 10 m = 10 m²;
  // (10,10)->(0,10) rise 2 m over 10 m = 20 m²; (0,10)->(0,0) mean 1 m over 10 m = 10 m².
  assert.ok(Math.abs(m.buriedWallArea! - 40) < 1e-6, `buried wall came out ${m.buriedWallArea}`)
})
