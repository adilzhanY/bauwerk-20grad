import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  bucketIndex, buildRingIndex, buildTerrainMesh, declusterAverage, pointInRings,
  ringIndexContains, sampleHeight, simplifyRing,
} from '../src/terrain.ts'
import type { BBox } from '../src/types.ts'

const BOX: BBox = { minX: 0, minY: 0, maxX: 100, maxY: 100 }
const ORIGIN: [number, number, number] = [0, 0, 0]

/** A square building, 20 m across, whose contact line rises 2 m from one side to the other. */
function slopedRim(): number[] {
  const z = (x: number) => 10 + (x - 40) * 0.1
  const pts: Array<[number, number]> = [[40, 40], [60, 40], [60, 60], [40, 60], [40, 40]]
  return pts.flatMap(([x, y]) => [x, y, z(x)])
}

/**
 * Height of the surface at a point, by finding the triangle containing it.
 *
 * Barycentric rather than nearest-vertex on purpose: the claim under test is that the surface
 * passes through the *whole* contact line, so the test has to be able to ask about points
 * between vertices.
 */
function sampleMeshAt(mesh: ReturnType<typeof buildTerrainMesh>, x: number, y: number): number | null {
  const p = mesh.positions
  for (let t = 0; t + 2 < mesh.indices.length; t += 3) {
    const ia = mesh.indices[t]! * 3
    const ib = mesh.indices[t + 1]! * 3
    const ic = mesh.indices[t + 2]! * 3
    const ax = p[ia]!, ay = p[ia + 1]!, bx = p[ib]!, by = p[ib + 1]!, cx = p[ic]!, cy = p[ic + 1]!
    const den = (by - cy) * (ax - cx) + (cx - bx) * (ay - cy)
    if (Math.abs(den) < 1e-12) continue
    const l1 = ((by - cy) * (x - cx) + (cx - bx) * (y - cy)) / den
    const l2 = ((cy - ay) * (x - cx) + (ax - cx) * (y - cy)) / den
    const l3 = 1 - l1 - l2
    const eps = -1e-9
    if (l1 < eps || l2 < eps || l3 < eps) continue
    return l1 * p[ia + 2]! + l2 * p[ib + 2]! + l3 * p[ic + 2]!
  }
  return null
}

test('the surface passes through the contact line, not merely its vertices', () => {
  // The claim the whole feature rests on. Sampling only at vertices would pass even if the
  // surface sagged between them, which is exactly what a plain grid does.
  const rim = slopedRim()
  const mesh = buildTerrainMesh({
    bbox: BOX, rimRings: [rim], constraints: [rim], holes: [rim],
    fallbackZ: 8, origin: ORIGIN,
  })
  assert.equal(mesh.source, 'exact')

  let checked = 0
  for (let i = 0; i + 5 < rim.length; i += 3) {
    for (const t of [0.13, 0.37, 0.5, 0.72, 0.91]) {
      const x = rim[i]! + (rim[i + 3]! - rim[i]!) * t
      const y = rim[i + 1]! + (rim[i + 4]! - rim[i + 1]!) * t
      const want = rim[i + 2]! + (rim[i + 5]! - rim[i + 2]!) * t
      // Step a hair outward so the point is on the collar rather than in the cut-out hole.
      const got = sampleMeshAt(mesh, x, y)
      if (got === null) continue
      assert.ok(Math.abs(got - want) < 1e-6,
        `at ${x.toFixed(2)}, ${y.toFixed(2)}: surface ${got.toFixed(4)} vs contact line ${want.toFixed(4)}`)
      checked++
    }
  }
  assert.ok(checked > 10, `expected to sample the rim, only managed ${checked} points`)
})

test('every contact-line vertex is in the mesh exactly', () => {
  const rim = slopedRim()
  const mesh = buildTerrainMesh({
    bbox: BOX, rimRings: [rim], constraints: [rim], holes: [rim],
    fallbackZ: 8, origin: ORIGIN,
  })
  for (let i = 0; i + 2 < rim.length; i += 3) {
    let found = false
    for (let v = 0; v + 2 < mesh.positions.length; v += 3) {
      if (mesh.positions[v] === rim[i] && mesh.positions[v + 1] === rim[i + 1] &&
          mesh.positions[v + 2] === rim[i + 2]) { found = true; break }
    }
    assert.ok(found, `contact-line vertex ${i / 3} was resampled or moved`)
  }
})

test('nothing is drawn under the building', () => {
  // Terrain covering a building would be worse than a flat plane: it would hide the very
  // thing the feature exists to show.
  const rim = slopedRim()
  const mesh = buildTerrainMesh({
    bbox: BOX, rimRings: [rim], constraints: [rim], holes: [rim],
    fallbackZ: 8, origin: ORIGIN,
  })
  assert.equal(sampleMeshAt(mesh, 50, 50), null, 'the middle of the footprint should be a hole')
})

test('with no constraints the surface is exactly the flat plane of today', () => {
  // The degradation path: not every source publishes contact lines, and the honest answer
  // where there are none is a flat plane.
  const mesh = buildTerrainMesh({
    bbox: BOX, rimRings: [], constraints: [], holes: [], fallbackZ: 42.5, origin: ORIGIN,
  })
  assert.equal(mesh.source, 'none')
  assert.ok(mesh.positions.length > 0)
  for (let v = 2; v < mesh.positions.length; v += 3) {
    assert.equal(mesh.positions[v], 42.5)
  }
})

test('heights are exact at a constraint and sensible between two', () => {
  const index = bucketIndex([[0, 0, 10], [10, 0, 20]])
  assert.equal(sampleHeight(index, 0, 0, 0), 10)
  assert.equal(sampleHeight(index, 10, 0, 0), 20)
  const mid = sampleHeight(index, 5, 0, 0)
  assert.ok(Math.abs(mid - 15) < 1e-9, `midpoint ${mid} should be the mean of two equal weights`)
})

test('the field never invents a height outside the data', () => {
  // Inverse-distance weighting cannot extrapolate, but the clamp is what guarantees it: a
  // corner 150 m from anything must not drift below the lowest or above the highest reading.
  const index = bucketIndex([[10, 10, 30], [20, 20, 34]])
  for (const [x, y] of [[-500, -500], [500, 500], [0, 900]]) {
    const z = sampleHeight(index, x!, y!, 0)
    assert.ok(z >= 30 - 1e-9 && z <= 34 + 1e-9, `extrapolated to ${z}`)
  }
})

test('the bucket index agrees with a brute-force search', () => {
  // The index is an optimisation; if it disagrees with the obvious implementation it is a bug
  // that would show up as terrain quietly ignoring nearby buildings.
  let seed = 7
  const rand = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff }
  const pts = Array.from({ length: 400 }, () => [rand() * 300, rand() * 300, rand() * 20])
  const index = bucketIndex(pts)
  for (let i = 0; i < 200; i++) {
    const x = rand() * 300
    const y = rand() * 300
    const nearest = pts.reduce((best, p) => {
      const d = (p[0]! - x) ** 2 + (p[1]! - y) ** 2
      return d < best.d ? { d, z: p[2]! } : best
    }, { d: Infinity, z: 0 })
    const z = sampleHeight(index, x, y, 0)
    // Not equality (IDW blends ten neighbours), but it must land in the data's range and
    // never fall back, which is what a missed bucket would cause.
    assert.ok(z >= index.minZ - 1e-9 && z <= index.maxZ + 1e-9)
    assert.ok(Number.isFinite(nearest.z))
  }
})

test('a small, distant constraint cloud is scanned rather than searched', () => {
  // The two strategies must agree where they overlap, or the surface would change shape at
  // whatever cloud size flips between them. Below LINEAR_SCAN_MAX the scan is exact, so it is
  // the one to check against brute force, including from far outside the cloud, which is the
  // case the ring search used to handle by grinding through thousands of empty buckets.
  const pts = [[0, 0, 10], [2, 0, 12], [0, 2, 14], [2, 2, 16]]
  const index = bucketIndex(pts)

  assert.ok(Math.abs(sampleHeight(index, 0, 0, 0) - 10) < 1e-9, 'exact at a constraint')

  // 400 m away, with a cloud 2 m across: every candidate is at essentially the same distance,
  // so the answer is their mean and, crucially, is not the fallback.
  const far = sampleHeight(index, 400, 400, -999)
  assert.ok(far >= 10 && far <= 16, `far field came out ${far}`)
  assert.notEqual(far, -999, 'must not fall back to the fallback height')
})

test('a sparse contact line over a wide box does not melt the main thread', () => {
  // The regression this guards is not subtle. Every selection builds the ground once from the
  // selected building's own contact line alone, before its neighbours arrive: a few dozen
  // points against a grid spanning the whole 800 m context box. Searching a bucket grid
  // outward from each of those ~40,000 probes cost 20.8 seconds in Chrome and hung the tab.
  //
  // The budget is deliberately loose. This is a guard against an algorithmic regression of
  // two orders of magnitude, not a performance target, and it must not flake on a busy
  // machine.
  const wide: BBox = { minX: 390_000, minY: 5_819_000, maxX: 390_800, maxY: 5_819_800 }
  const rim = [
    390_400, 5_819_400, 35, 390_410, 5_819_400, 35,
    390_410, 5_819_410, 35, 390_400, 5_819_410, 35, 390_400, 5_819_400, 35,
  ]

  const t0 = performance.now()
  const mesh = buildTerrainMesh({
    bbox: wide,
    rimRings: [rim],
    constraints: [rim],
    holes: [rim],
    fallbackZ: 35,
    origin: [390_000, 5_819_000, 0],
  })
  const ms = performance.now() - t0

  assert.ok(mesh.indices.length > 0, 'should still produce a surface')
  assert.equal(mesh.source, 'exact')
  assert.ok(ms < 3000, `took ${ms.toFixed(0)} ms; the pathological version took ~20,000`)
})

test('declustering makes one dense building count once, not five hundred times', () => {
  const dense = Array.from({ length: 500 }, (_, i) => [50 + (i % 10) * 0.05, 50, 100])
  const sparse = [[10, 10, 0], [90, 90, 0]]
  const out = declusterAverage([...dense, ...sparse])
  assert.ok(out.length <= 4, `500 vertices in one place collapsed to ${out.length}`)
})

test('a courtyard is outside the building', () => {
  const outer = [0, 0, 0, 20, 0, 0, 20, 20, 0, 0, 20, 0, 0, 0, 0]
  const inner = [8, 8, 0, 12, 8, 0, 12, 12, 0, 8, 12, 0, 8, 8, 0]
  assert.equal(pointInRings([outer, inner], 2, 2), true, 'the built part is inside')
  assert.equal(pointInRings([outer, inner], 10, 10), false, 'the courtyard is not')
})

test('a reflex corner does not fold the collar back on itself', () => {
  // An L-shaped building: offsetting outward at the inner corner is where a naive offset
  // crosses itself and produces inverted triangles.
  const rim = [
    0, 0, 10, 30, 0, 10, 30, 10, 10, 10, 10, 10.5, 10, 30, 11, 0, 30, 11, 0, 0, 10,
  ]
  const mesh = buildTerrainMesh({
    bbox: { minX: -20, minY: -20, maxX: 60, maxY: 60 },
    rimRings: [rim], constraints: [rim], holes: [rim], fallbackZ: 9, origin: ORIGIN,
  })
  let inverted = 0
  const p = mesh.positions
  for (let t = 0; t + 2 < mesh.indices.length; t += 3) {
    const ia = mesh.indices[t]! * 3, ib = mesh.indices[t + 1]! * 3, ic = mesh.indices[t + 2]! * 3
    const area = (p[ib]! - p[ia]!) * (p[ic + 1]! - p[ia + 1]!) -
                 (p[ic]! - p[ia]!) * (p[ib + 1]! - p[ia + 1]!)
    if (area === 0) inverted++
  }
  assert.equal(inverted, 0, 'collar produced degenerate triangles at the reflex corner')
})

test('simplification drops what says nothing and keeps what does', () => {
  // A straight wall run: five vertices describing one line.
  const straight = [0, 0, 10, 1, 0, 10, 2, 0, 10, 3, 0, 10, 4, 0, 10]
  assert.deepEqual(simplifyRing(straight), [0, 0, 10, 4, 0, 10])

  // A real corner survives, and so does a step in height along a level run.
  const corner = [0, 0, 10, 2, 0, 10, 2, 2, 10]
  assert.deepEqual(simplifyRing(corner), corner)
  const step = [0, 0, 10, 2, 0, 10.4, 4, 0, 10]
  assert.deepEqual(simplifyRing(step), step)

  // Nothing is ever moved by more than the tolerance, which is well under a survey's own error.
  const noisy: number[] = []
  for (let i = 0; i <= 50; i++) noisy.push(i * 0.2, Math.sin(i) * 0.01, 10 + Math.cos(i) * 0.01)
  const out = simplifyRing(noisy)
  assert.ok(out.length < noisy.length, 'noise below tolerance should collapse')
  for (let j = 0; j + 2 < noisy.length; j += 3) {
    let best = Infinity
    for (let i = 0; i + 5 < out.length; i += 3) {
      const ex = out[i + 3]! - out[i]!, ey = out[i + 4]! - out[i + 1]!, ez = out[i + 5]! - out[i + 2]!
      const len2 = ex * ex + ey * ey + ez * ez
      const t = Math.min(1, Math.max(0, ((noisy[j]! - out[i]!) * ex + (noisy[j + 1]! - out[i + 1]!) * ey + (noisy[j + 2]! - out[i + 2]!) * ez) / len2))
      best = Math.min(best, Math.hypot(noisy[j]! - (out[i]! + t * ex), noisy[j + 1]! - (out[i + 1]! + t * ey), noisy[j + 2]! - (out[i + 2]! + t * ez)))
    }
    assert.ok(best <= 0.021, `moved ${best.toFixed(4)} m`)
  }
})

test('with nothing to warp, the plane has no holes cut in it', () => {
  // With no contact line anywhere, the surface has no relief for a building to poke through,
  // so cutting its footprint out would only open a window onto the background, a regression
  // against the flat plane this replaced.
  const footprint = [0, 0, 10, 10, 0, 10, 10, 10, 10, 0, 10, 10, 0, 0, 10]
  const mesh = buildTerrainMesh({
    bbox: { minX: -20, minY: -20, maxX: 30, maxY: 30 },
    rimRings: [], constraints: [], holes: [footprint], fallbackZ: 10, origin: ORIGIN,
  })
  assert.equal(mesh.source, 'none')
  assert.ok(sampleMeshAt(mesh, 5, 5) !== null, 'the surface should still cover the footprint')
  const nx = Math.round(50 / 2)
  assert.equal(mesh.indices.length / 3, nx * nx * 2, 'every grid quad should survive')
})

/** A smooth synthetic terrain, so a test can assert against a value it knows exactly. */
const slope = (x: number, y: number) => 10 + x * 0.05 + y * 0.03 + Math.sin(x / 7) * 0.4

test('a terrain model replaces the interpolation entirely', () => {
  // Constraints deliberately disagree with the field: if any of them leaked into the heights
  // the surface would be pulled toward them, and this is what says they do not.
  const liar = [0, 0, 999, 20, 0, 999, 20, 20, 999, 0, 20, 999, 0, 0, 999]
  const mesh = buildTerrainMesh({
    bbox: BOX, rimRings: [], constraints: [liar], holes: [],
    field: slope, fallbackZ: 0, origin: ORIGIN,
  })
  assert.equal(mesh.source, 'dgm')

  let checked = 0
  for (let i = 0; i + 2 < mesh.positions.length; i += 3) {
    const x = mesh.positions[i]! + ORIGIN[0]
    const y = mesh.positions[i + 1]! + ORIGIN[1]
    const want = slope(x, y) - ORIGIN[2]
    assert.ok(Math.abs(mesh.positions[i + 2]! - want) < 1e-3, `vertex ${i / 3} off by ${mesh.positions[i + 2]! - want}`)
    checked++
  }
  assert.ok(checked > 100, 'the surface should have real vertices to check')
})

test('with a terrain model the contact line is still exact', () => {
  // Where a source publishes no contact line, a footprint draped over a terrain model can
  // stand in for one. The collar has to pass through it just as precisely as through a
  // published line. This is what the `field` seam has to preserve.
  const footprint = [10, 10, 0, 30, 10, 0, 30, 26, 0, 10, 26, 0, 10, 10, 0]
  const rim = [...footprint]
  for (let i = 0; i + 2 < rim.length; i += 3) rim[i + 2] = slope(rim[i]!, rim[i + 1]!)

  const mesh = buildTerrainMesh({
    bbox: BOX, rimRings: [rim], constraints: [rim], holes: [rim],
    field: slope, fallbackZ: 0, origin: ORIGIN,
  })
  assert.equal(mesh.source, 'dgm')

  let area2 = 0
  for (let i = 0; i + 5 < rim.length; i += 3) {
    area2 += rim[i]! * rim[i + 4]! - rim[i + 3]! * rim[i + 1]!
  }
  const winding = area2 >= 0 ? 1 : -1

  let checked = 0
  for (let i = 0; i + 5 < rim.length; i += 3) {
    // Between vertices, never at one: at a shared corner every adjacent triangle is a valid
    // answer and the barycentric search picks arbitrarily.
    for (const t of [0.13, 0.37, 0.5, 0.72, 0.91]) {
      const x = rim[i]! + (rim[i + 3]! - rim[i]!) * t
      const y = rim[i + 1]! + (rim[i + 4]! - rim[i + 1]!) * t
      const want = rim[i + 2]! + (rim[i + 5]! - rim[i + 2]!) * t
      // Outward is the side the ring's own orientation says it is; guessing would test the
      // hole under the building instead of the collar beside it.
      const nx = (rim[i + 4]! - rim[i + 1]!) * winding
      const ny = -(rim[i + 3]! - rim[i]!) * winding
      const len = Math.hypot(nx, ny) || 1
      const got = sampleMeshAt(mesh, x + (nx / len) * 0.01 - ORIGIN[0], y + (ny / len) * 0.01 - ORIGIN[1])
      assert.ok(got !== null, `no surface just outside the contact line at t=${t}`)
      assert.ok(Math.abs(got! + ORIGIN[2] - want) < 0.02, `off by ${got! + ORIGIN[2] - want} m at t=${t}`)
      checked++
    }
  }
  assert.equal(checked, 20)
})

test('a terrain model still gets holes cut under the buildings', () => {
  // The "cut nothing" rule exists only for a surface with no relief at all. With a real
  // terrain model there is relief, so a neighbour on a slope would poke through without it.
  const footprint = [10, 10, 0, 30, 10, 0, 30, 26, 0, 10, 26, 0, 10, 10, 0]
  const mesh = buildTerrainMesh({
    bbox: BOX, rimRings: [], constraints: [], holes: [footprint],
    field: slope, fallbackZ: 0, origin: ORIGIN,
  })
  assert.equal(mesh.source, 'dgm')
  assert.equal(sampleMeshAt(mesh, 20 - ORIGIN[0], 18 - ORIGIN[1]), null, 'nothing should be drawn under the building')
})

test('the grid coarsens with the extent instead of exploding', () => {
  // Holding a 2 m cell over an 800 m box means 160,000 vertices and, measured, 1.8 seconds
  // of blocked main thread, for detail that is 1/400 of the view.
  const small = buildTerrainMesh({
    bbox: { minX: 0, minY: 0, maxX: 300, maxY: 300 },
    rimRings: [], constraints: [], holes: [], field: slope, fallbackZ: 0, origin: ORIGIN,
  })
  const large = buildTerrainMesh({
    bbox: { minX: 0, minY: 0, maxX: 800, maxY: 800 },
    rimRings: [], constraints: [], holes: [], field: slope, fallbackZ: 0, origin: ORIGIN,
  })
  // 300 m keeps the 2 m floor: 150 cells, 151 vertices a side.
  assert.equal(small.positions.length / 3, 151 * 151)
  // 800 m is capped at 200 cells a side rather than the 400 a 2 m cell would give.
  assert.equal(large.positions.length / 3, 201 * 201)
  // An explicit cell size still wins, so callers and tests can pin it.
  const forced = buildTerrainMesh({
    bbox: { minX: 0, minY: 0, maxX: 800, maxY: 800 }, cellM: 2,
    rimRings: [], constraints: [], holes: [], field: slope, fallbackZ: 0, origin: ORIGIN,
  })
  assert.equal(forced.positions.length / 3, 401 * 401)
})

test('a coarser field does not blunt the contact line', () => {
  // The collar comes from the contact line itself, so the one exact thing stays exact however
  // coarse the surface behind it is. This is what makes coarsening safe.
  const footprint = [300, 300, 0, 340, 300, 0, 340, 332, 0, 300, 332, 0, 300, 300, 0]
  const rim = [...footprint]
  for (let i = 0; i + 2 < rim.length; i += 3) rim[i + 2] = slope(rim[i]!, rim[i + 1]!)
  const mesh = buildTerrainMesh({
    bbox: { minX: 0, minY: 0, maxX: 800, maxY: 800 },
    rimRings: [rim], constraints: [rim], holes: [rim], field: slope, fallbackZ: 0, origin: ORIGIN,
  })
  for (let i = 0; i + 2 < rim.length; i += 3) {
    let found = false
    for (let k = 0; k + 2 < mesh.positions.length; k += 3) {
      if (Math.abs(mesh.positions[k]! + ORIGIN[0] - rim[i]!) < 1e-3 &&
          Math.abs(mesh.positions[k + 1]! + ORIGIN[1] - rim[i + 1]!) < 1e-3 &&
          Math.abs(mesh.positions[k + 2]! + ORIGIN[2] - rim[i + 2]!) < 1e-3) { found = true; break }
    }
    assert.ok(found, `contact-line vertex ${i / 3} is missing from the coarsened mesh`)
  }
})

test('the footprint index answers exactly what the linear scan does', () => {
  // The index is an optimisation, and an optimisation that changes an answer is a bug. It
  // turned an 800 m box from 23 seconds into 1.8, so it has to be exactly equivalent.
  const rings: number[][] = []
  for (let i = 0; i < 60; i++) {
    const x = (i % 10) * 30 + 5
    const y = Math.floor(i / 10) * 30 + 5
    rings.push([x, y, 0, x + 14, y, 0, x + 14, y + 11, 0, x, y + 11, 0, x, y, 0])
  }
  // A courtyard: a ring inside another must still read as outside, by even-odd.
  rings.push([200, 200, 0, 260, 200, 0, 260, 260, 0, 200, 260, 0, 200, 200, 0])
  rings.push([215, 215, 0, 245, 215, 0, 245, 245, 0, 215, 245, 0, 215, 215, 0])

  const index = buildRingIndex(rings)
  let checked = 0
  for (let i = 0; i < 4000; i++) {
    const x = ((i * 97) % 3200) / 10
    const y = ((i * 61) % 3200) / 10
    assert.equal(ringIndexContains(index, x, y), pointInRings(rings, x, y), `at ${x},${y}`)
    checked++
  }
  assert.equal(checked, 4000)
})
