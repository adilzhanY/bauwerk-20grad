import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { Vec3 } from '../src/geometry.ts'
import {
  cross,
  dot,
  newellNormal,
  normalize,
  orthoUv,
  ringArea3d,
  ringAreaProjected,
  tiltDeg,
  azimuthDeg,
  solidVolume,
  isClosedSolid,
  triangulatePolygon,
} from '../src/geometry.ts'
import type { Polygon } from '../src/types.ts'

const ring = (...pts: Array<[number, number, number]>): number[] => {
  const first = pts[0]!
  return [...pts, first].flat()
}
const poly = (exterior: number[], interiors: number[][] = []): Polygon => ({ exterior, interiors })

/**
 * Unit cube, 1 x 1 x 1, sitting on z = 0, with every face wound counter-clockwise
 * seen from outside — the same convention AdV uses.
 */
const unitCube = (): Polygon[] => [
  poly(ring([0, 0, 0], [0, 1, 0], [1, 1, 0], [1, 0, 0])), // ground, normal -z
  poly(ring([0, 0, 1], [1, 0, 1], [1, 1, 1], [0, 1, 1])), // roof, normal +z
  poly(ring([0, 0, 0], [1, 0, 0], [1, 0, 1], [0, 0, 1])), // south wall, normal -y
  poly(ring([1, 0, 0], [1, 1, 0], [1, 1, 1], [1, 0, 1])), // east wall, normal +x
  poly(ring([1, 1, 0], [0, 1, 0], [0, 1, 1], [1, 1, 1])), // north wall, normal +y
  poly(ring([0, 1, 0], [0, 0, 0], [0, 0, 1], [0, 1, 1])), // west wall, normal -x
]

test('newell normal of a horizontal unit square points up with magnitude = area', () => {
  const n = newellNormal(ring([0, 0, 5], [1, 0, 5], [1, 1, 5], [0, 1, 5]))
  assert.deepEqual(n.map((v) => Math.round(v * 1e9) / 1e9), [0, 0, 1])
  assert.equal(ringArea3d(ring([0, 0, 5], [1, 0, 5], [1, 1, 5], [0, 1, 5])), 1)
})

test('a 45-degree face has area sqrt(2) and projected area 1', () => {
  // 1 wide, rising 1 over a 1 m run: true area = sqrt(2), projection = 1.
  const r = ring([0, 0, 0], [1, 0, 0], [1, 1, 1], [0, 1, 1])
  assert.ok(Math.abs(ringArea3d(r) - Math.SQRT2) < 1e-12)
  assert.ok(Math.abs(ringAreaProjected(r) - 1) < 1e-12)
  assert.ok(Math.abs(tiltDeg(newellNormal(r)) - 45) < 1e-9)
})

test('tilt is 0 for flat, 90 for vertical, 180 for a downward face', () => {
  assert.equal(tiltDeg([0, 0, 1]), 0)
  assert.ok(Math.abs(tiltDeg([1, 0, 0]) - 90) < 1e-9)
  assert.ok(Math.abs(tiltDeg([0, 0, -1]) - 180) < 1e-9)
})

test('azimuth is a compass bearing: +y is north, +x is east', () => {
  assert.equal(azimuthDeg([0, 1, 0]), 0) // north
  assert.equal(azimuthDeg([1, 0, 0]), 90) // east
  assert.equal(azimuthDeg([0, -1, 0]), 180) // south
  assert.equal(azimuthDeg([-1, 0, 0]), 270) // west
  assert.equal(azimuthDeg([0, 0, 1]), null) // flat roof has no bearing
})

test('a south-facing 30-degree roof reports azimuth 180 and tilt 30', () => {
  const run = Math.cos(Math.PI / 6)
  const rise = Math.sin(Math.PI / 6)
  // Low edge at y = 0, high edge at y = run: the face slopes down toward -y, so its
  // outward normal leans south. Wound counter-clockwise seen from above.
  const r = ring([0, 0, 0], [10, 0, 0], [10, run, rise], [0, run, rise])
  const n = newellNormal(r)
  assert.ok(Math.abs(tiltDeg(n) - 30) < 1e-9, `tilt was ${tiltDeg(n)}`)
  assert.ok(Math.abs(azimuthDeg(n)! - 180) < 1e-9, `azimuth was ${azimuthDeg(n)}`)
})

test('unit cube: volume 1, closed, wall area 4, roof area 1', () => {
  const cube = unitCube()
  assert.ok(isClosedSolid(cube), 'cube should be watertight')
  assert.ok(Math.abs(solidVolume(cube) - 1) < 1e-12, `volume was ${solidVolume(cube)}`)

  const normals = cube.map((p) => normalize(newellNormal(p.exterior)))
  const roof = cube.filter((_, i) => normals[i]![2] > 0.5)
  const walls = cube.filter((_, i) => Math.abs(normals[i]![2]) < 0.5)
  assert.equal(roof.length, 1)
  assert.equal(walls.length, 4)
  assert.ok(Math.abs(walls.reduce((s, p) => s + ringArea3d(p.exterior), 0) - 4) < 1e-12)
})

test('gable-roofed house has the hand-computed volume', () => {
  // 10 x 6 footprint, eaves at 3 m, ridge at 6 m running along x at y = 3.
  // Volume = box (10*6*3 = 180) + prism (0.5 * 6 * 3 * 10 = 90) = 270.
  const L = 10
  const W = 6
  const H = 3
  const R = 6
  const solid: Polygon[] = [
    poly(ring([0, 0, 0], [0, W, 0], [L, W, 0], [L, 0, 0])), // ground, normal -z
    poly(ring([0, 0, 0], [L, 0, 0], [L, 0, H], [0, 0, H])), // south wall
    poly(ring([L, W, 0], [0, W, 0], [0, W, H], [L, W, H])), // north wall
    // gable ends (pentagons)
    poly(ring([L, 0, 0], [L, W, 0], [L, W, H], [L, W / 2, R], [L, 0, H])), // east
    poly(ring([0, W, 0], [0, 0, 0], [0, 0, H], [0, W / 2, R], [0, W, H])), // west
    poly(ring([0, 0, H], [L, 0, H], [L, W / 2, R], [0, W / 2, R])), // south roof
    poly(ring([L, W, H], [0, W, H], [0, W / 2, R], [L, W / 2, R])), // north roof
  ]
  assert.ok(isClosedSolid(solid), 'gable solid should be watertight')
  assert.ok(Math.abs(solidVolume(solid) - 270) < 1e-9, `volume was ${solidVolume(solid)}`)

  const southRoof = solid[5]!
  const n = newellNormal(southRoof.exterior)
  assert.ok(Math.abs(azimuthDeg(n)! - 180) < 1e-9, `south roof azimuth ${azimuthDeg(n)}`)
  // pitch: rise 3 over run 3 => 45 degrees
  assert.ok(Math.abs(tiltDeg(n) - 45) < 1e-9, `south roof tilt ${tiltDeg(n)}`)
  // true area = 10 * sqrt(3^2 + 3^2)
  assert.ok(Math.abs(ringArea3d(southRoof.exterior) - L * Math.hypot(3, 3)) < 1e-9)
})

test('an open solid is detected rather than silently measured', () => {
  const openBox = unitCube().slice(0, 5) // drop the west wall
  assert.equal(isClosedSolid(openBox), false)
})

test('polygon with a hole triangulates and loses the hole area', () => {
  const outer = ring([0, 0, 0], [10, 0, 0], [10, 10, 0], [0, 10, 0])
  const hole = ring([4, 4, 0], [4, 6, 0], [6, 6, 0], [6, 4, 0])
  const p = poly(outer, [hole])
  const { indices } = triangulatePolygon(p)
  assert.ok(indices.length > 0, 'should produce triangles')
  assert.equal(ringArea3d(outer) - ringArea3d(hole), 96)
})

test('volume survives being computed at real UTM coordinates', () => {
  // Regression: the divergence-theorem sum is origin-independent in exact arithmetic but
  // not in float64. At EPSG:25832 magnitudes (x~2.8e5, y~5.66e6) an unrebased integration
  // returned 6.5e7 m3 for a 94 m3 house — pure cancellation noise.
  const cube = unitCube()
  const shifted = cube.map((p) => ({
    exterior: p.exterior.map((v, i) => (i % 3 === 0 ? v + 280942 : i % 3 === 1 ? v + 5657541 : v + 38)),
    interiors: [] as number[][],
  }))
  assert.ok(isClosedSolid(shifted), 'shifted cube should still be watertight')
  const v = solidVolume(shifted)
  assert.ok(Math.abs(v - 1) < 1e-6, `volume at UTM coordinates was ${v}, expected 1`)
})

test('areas are translation-invariant too', () => {
  const r = ring([0, 0, 0], [10, 0, 0], [10, 6, 3], [0, 6, 3])
  const shifted = r.map((v, i) => (i % 3 === 0 ? v + 280942 : i % 3 === 1 ? v + 5657541 : v + 38))
  assert.ok(Math.abs(ringArea3d(r) - ringArea3d(shifted)) < 1e-6)
})

test('triangulation preserves each face orientation', () => {
  // Regression, and the reason the volume bug survived every earlier test: earcut
  // always emits counter-clockwise triangles in the 2D projection, discarding the
  // input winding. That flips every face whose normal points down the dropped axis.
  // It stayed invisible because solidVolume rebases to the solid's minimum corner,
  // and for an axis-aligned box the three faces touching that corner contribute
  // exactly zero to the integral — and they are precisely the flipped ones.
  const triangulatedNormal = (p: Polygon): Vec3 => {
    const { positions, indices } = triangulatePolygon(p)
    let n: Vec3 = [0, 0, 0]
    for (let t = 0; t + 2 < indices.length; t += 3) {
      const a = indices[t]! * 3
      const b = indices[t + 1]! * 3
      const c = indices[t + 2]! * 3
      const u: Vec3 = [positions[b]! - positions[a]!, positions[b + 1]! - positions[a + 1]!, positions[b + 2]! - positions[a + 2]!]
      const v: Vec3 = [positions[c]! - positions[a]!, positions[c + 1]! - positions[a + 1]!, positions[c + 2]! - positions[a + 2]!]
      const w = cross(u, v)
      n = [n[0] + w[0], n[1] + w[1], n[2] + w[2]]
    }
    return n
  }

  for (const face of unitCube()) {
    const expected = newellNormal(face.exterior)
    const actual = triangulatedNormal(face)
    assert.ok(
      dot(expected, actual) > 0,
      `face with normal [${expected.map((v) => v.toFixed(1))}] triangulated to [${actual.map((v) => v.toFixed(1))}]`,
    )
  }
})

test('volume is right for a solid whose oblique faces cannot cancel', () => {
  // A pyramid: unlike a box, its side faces are oblique, so a flipped face changes
  // the answer instead of contributing zero. V = 1/3 * base * height = 1/3 * 16 * 3.
  const apex: [number, number, number] = [2, 2, 3]
  const pyramid: Polygon[] = [
    poly(ring([0, 0, 0], [0, 4, 0], [4, 4, 0], [4, 0, 0])), // base, normal -z
    poly(ring([0, 0, 0], [4, 0, 0], apex)),
    poly(ring([4, 0, 0], [4, 4, 0], apex)),
    poly(ring([4, 4, 0], [0, 4, 0], apex)),
    poly(ring([0, 4, 0], [0, 0, 0], apex)),
  ]
  assert.ok(isClosedSolid(pyramid), 'pyramid should be watertight')
  const v = solidVolume(pyramid)
  assert.ok(Math.abs(v - 16) < 1e-9, `pyramid volume was ${v}, expected 16`)
})

test('volume never exceeds the axis-aligned bounding box', () => {
  // The invariant that exposed the bug on real data: a closed solid cannot enclose
  // more than its own bounding box.
  const shapes: Polygon[][] = [unitCube(), [
    poly(ring([0, 0, 0], [0, 4, 0], [4, 4, 0], [4, 0, 0])),
    poly(ring([0, 0, 0], [4, 0, 0], [2, 2, 3])),
    poly(ring([4, 0, 0], [4, 4, 0], [2, 2, 3])),
    poly(ring([4, 4, 0], [0, 4, 0], [2, 2, 3])),
    poly(ring([0, 4, 0], [0, 0, 0], [2, 2, 3])),
  ]]
  for (const shape of shapes) {
    const all = shape.flatMap((p) => p.exterior)
    const xs: number[] = []
    const ys: number[] = []
    const zs: number[] = []
    for (let i = 0; i + 2 < all.length; i += 3) {
      xs.push(all[i]!)
      ys.push(all[i + 1]!)
      zs.push(all[i + 2]!)
    }
    const bbox =
      (Math.max(...xs) - Math.min(...xs)) *
      (Math.max(...ys) - Math.min(...ys)) *
      (Math.max(...zs) - Math.min(...zs))
    assert.ok(solidVolume(shape) <= bbox + 1e-9)
  }
})

test('ortho UVs place a vertex by its position within the image bbox', () => {
  const bbox = [365000, 5621000, 365100, 5621100] as const

  assert.deepEqual(orthoUv(365000, 5621000, bbox), [0, 0], 'south-west corner')
  assert.deepEqual(orthoUv(365100, 5621100, bbox), [1, 1], 'north-east corner')
  assert.deepEqual(orthoUv(365050, 5621050, bbox), [0.5, 0.5], 'centre')
  assert.deepEqual(orthoUv(365025, 5621075, bbox), [0.25, 0.75], 'arbitrary interior point')
})

test('ortho UVs clamp outside the bbox rather than wrapping', () => {
  // A vertex just past the image edge must smear the edge pixel. Wrapping would paint
  // the opposite side of the image onto the overhang, which looks plausible and is wrong.
  const bbox = [0, 0, 100, 100] as const
  assert.deepEqual(orthoUv(-50, 150, bbox), [0, 1])
  assert.deepEqual(orthoUv(1e6, -1e6, bbox), [1, 0])
})

test('ortho UVs survive a degenerate bbox instead of returning NaN', () => {
  assert.deepEqual(orthoUv(5, 5, [10, 10, 10, 10] as const), [0, 0])
})
