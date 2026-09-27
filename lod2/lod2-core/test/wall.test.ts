import { test } from 'node:test'
import assert from 'node:assert/strict'
import { clipRingAboveZ, planeToWorld, wallArea, wallAzimuth, wallGroundLevel, wallToPlane } from '../src/wall.ts'

const near = (a: number, b: number, eps = 1e-6) => Math.abs(a - b) < eps

const ring = (...pts: Array<[number, number, number]>): number[] => {
  const flat = pts.flat()
  return [...flat, ...pts[0]!]
}

// A 6 m wide, 3 m high wall at real UTM coordinates, standing on the x = 390000 line and
// facing east (+x). Wound so the Newell normal points east, as AdV walls do.
const eastWall = ring(
  [390000, 5820000, 40],
  [390000, 5820006, 40],
  [390000, 5820006, 43],
  [390000, 5820000, 43],
)

test('a vertical rectangle lays flat with its known width and height', () => {
  const plane = wallToPlane(eastWall)
  assert.ok(plane)
  assert.ok(near(plane.width, 6))
  assert.ok(near(plane.height, 3))
  assert.ok(near(plane.normal[0], 1) && near(plane.normal[1], 0) && near(plane.normal[2], 0))
})

test('the flat corners sit at the rectangle corners, bottom left at the origin', () => {
  const plane = wallToPlane(eastWall)!
  const sorted = [...plane.points].sort((a, b) => a.x - b.x || a.y - b.y)
  const expected = [
    { x: 0, y: 0 }, { x: 0, y: 3 }, { x: 6, y: 0 }, { x: 6, y: 3 },
  ]
  for (let i = 0; i < 4; i++) {
    assert.ok(near(sorted[i]!.x, expected[i]!.x), `x of corner ${i}`)
    assert.ok(near(sorted[i]!.y, expected[i]!.y), `y of corner ${i}`)
  }
})

test('u runs left to right for a viewer standing outside, facing the wall', () => {
  // Facing east means the viewer looks west; their right hand points north (+y).
  const plane = wallToPlane(eastWall)!
  assert.ok(near(plane.u[0], 0) && near(plane.u[1], 1) && near(plane.u[2], 0))
})

test('wall metres map back to the original 3D corners', () => {
  const plane = wallToPlane(eastWall)!
  const bottomLeft = planeToWorld(plane, { x: 0, y: 0 })
  const topRight = planeToWorld(plane, { x: 6, y: 3 })
  assert.ok(near(bottomLeft[0], 390000) && near(bottomLeft[1], 5820000) && near(bottomLeft[2], 40))
  assert.ok(near(topRight[0], 390000) && near(topRight[1], 5820006) && near(topRight[2], 43))
})

test('a roof face is not a wall', () => {
  const roof = ring([0, 0, 10], [10, 0, 10], [10, 10, 12], [0, 10, 12])
  assert.equal(wallToPlane(roof), null)
})

test('a ring with too few points is rejected', () => {
  assert.equal(wallToPlane([0, 0, 0, 1, 0, 0, 0, 0, 0]), null)
})

test('a rectangular wall has area width times height', () => {
  assert.ok(near(wallArea(eastWall), 18))
})

test('a gable wall has less area than its bounding box', () => {
  // 6 m wide, 3 m to the eaves, ridge 1.5 m higher: rectangle 18 plus triangle 4.5.
  const gable = ring(
    [390000, 5820000, 40],
    [390000, 5820006, 40],
    [390000, 5820006, 43],
    [390000, 5820003, 44.5],
    [390000, 5820000, 43],
  )
  assert.ok(near(wallArea(gable), 22.5))
  const plane = wallToPlane(gable)!
  assert.ok(near(plane.width * plane.height, 27))
})

test('an east-facing wall has azimuth 90', () => {
  assert.ok(near(wallAzimuth(eastWall)!, 90))
  assert.ok(near(wallToPlane(eastWall)!.azimuth, 90))
})

test('a wall built to face 113 degrees reports 113', () => {
  // Bearing 113 is the direction (sin 113, cos 113) in (x, y). The wall runs at right
  // angles to it; wind it so the Newell normal points along the bearing.
  const bearing = (113 * Math.PI) / 180
  const nx = Math.sin(bearing)
  const ny = Math.cos(bearing)
  // Along-wall direction: rotate the normal 90 degrees clockwise seen from above.
  const ax = ny
  const ay = -nx
  const p = (t: number, z: number): [number, number, number] => [ax * t, ay * t, z]
  // Counter-clockwise seen from the outside so the normal comes out along the bearing.
  const wall = ring(p(0, 0), p(0, 3), p(6, 3), p(6, 0))
  const got = wallAzimuth(wall)!
  assert.ok(Math.abs(got - 113) < 0.1, `azimuth ${got}`)
})

test('a flat ground face has no bearing', () => {
  const ground = ring([0, 0, 0], [0, 10, 0], [10, 10, 0], [10, 0, 0])
  assert.equal(wallAzimuth(ground), null)
})

test('a ground level one metre up the wall leaves a 2 m high wall of 12 m²', () => {
  const plane = wallToPlane(eastWall, 41)!
  assert.ok(near(plane.width, 6) && near(plane.height, 2))
  assert.ok(near(plane.origin[2], 41), `origin z ${plane.origin[2]}`)
  assert.ok(near(wallArea(eastWall, 41), 12))
})

test('a ground level above the wall top leaves nothing', () => {
  assert.equal(wallToPlane(eastWall, 50), null)
  assert.equal(wallArea(eastWall, 50), 0)
  assert.deepEqual(clipRingAboveZ(eastWall, 50), [])
})

test('clipping a wall keeps its width and cuts the crossing edges at z', () => {
  const clipped = clipRingAboveZ(eastWall, 42)
  const zs: number[] = []
  for (let i = 2; i < clipped.length; i += 3) zs.push(clipped[i]!)
  assert.ok(Math.min(...zs) >= 42 - 1e-9)
  assert.ok(near(Math.max(...zs), 43))
})

test('ground level along a wall is the mean of the contact line vertices on its base', () => {
  // Contact line running along the wall's base at street heights 41.0 and 41.4, plus a
  // vertex 5 m away on another wall that must be ignored.
  const line = [
    390000, 5820000, 41.0,
    390000, 5820003, 41.2,
    390000, 5820006, 41.4,
    390005, 5820006, 45.0,
  ]
  assert.ok(near(wallGroundLevel(eastWall, [line])!, 41.2))
})

test('a wall the contact line never touches has no ground level', () => {
  const farLine = [390050, 5820000, 41, 390050, 5820006, 41]
  assert.equal(wallGroundLevel(eastWall, [farLine]), null)
  assert.equal(wallGroundLevel(eastWall, []), null)
})

test('a repeated contact-line vertex counts once in the ground level', () => {
  // Wall from (0,0) to (10,0), rising from z 0 to 6.
  const wall = [0, 0, 0, 10, 0, 0, 10, 0, 6, 0, 0, 6, 0, 0, 0]
  // Closed contact line: the vertex at (0,0) appears at the start and again at the end.
  const line = [0, 0, 1, 10, 0, 3, 10, 5, 3, 0, 5, 1, 0, 0, 1]
  assert.ok(near(wallGroundLevel(wall, [line])!, 2), `got ${wallGroundLevel(wall, [line])}`)
})
