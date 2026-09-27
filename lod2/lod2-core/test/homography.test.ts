import { test } from 'node:test'
import assert from 'node:assert/strict'
import { applyHomography, homographyFromPairs, invertHomography } from '../src/homography.ts'
import type { Point2, Quad } from '../src/photo.ts'

const assertNear = (got: Point2, want: Point2, tol: number, what: string) => {
  assert.ok(Math.abs(got.x - want.x) <= tol, `${what}: x ${got.x} vs ${want.x}`)
  assert.ok(Math.abs(got.y - want.y) <= tol, `${what}: y ${got.y} vs ${want.y}`)
}

// A 6 m by 3 m wall, corners in wall metres: top-left, top-right, bottom-right, bottom-left.
const wall: Quad = [
  { x: 0, y: 3 }, { x: 6, y: 3 }, { x: 6, y: 0 }, { x: 0, y: 0 },
]

test('a plain scale and shift is recovered within a pixel', () => {
  // The photo shows the wall at 100 px per metre, moved by 50 px, with y flipped so the
  // top of the wall is near the top of the image.
  const toPhoto = (p: Point2): Point2 => ({ x: 50 + 100 * p.x, y: 50 + 100 * (3 - p.y) })
  const photo = wall.map(toPhoto) as Quad

  const H = homographyFromPairs(wall, photo)
  assert.ok(H)
  for (const p of [...wall, { x: 3, y: 1.5 }, { x: 1, y: 2 }]) {
    assertNear(applyHomography(H, p), toPhoto(p), 1, `point ${p.x},${p.y}`)
  }
})

test('a perspective trapezoid maps the corners onto the dots and back', () => {
  // The camera stood to the left, so the right side of the wall looks smaller.
  const photo: Quad = [
    { x: 100, y: 80 }, { x: 900, y: 200 }, { x: 900, y: 500 }, { x: 100, y: 700 },
  ]
  const H = homographyFromPairs(wall, photo)
  assert.ok(H)
  for (let i = 0; i < 4; i++) {
    assertNear(applyHomography(H, wall[i]!), photo[i]!, 1, `corner ${i}`)
  }

  const back = invertHomography(H)
  assert.ok(back)
  const middle = { x: 2.5, y: 1 }
  assertNear(applyHomography(back, applyHomography(H, middle)), middle, 1e-6, 'round trip')
})

test('the middle of the wall is not the middle of the photo under perspective', () => {
  const photo: Quad = [
    { x: 100, y: 80 }, { x: 900, y: 200 }, { x: 900, y: 500 }, { x: 100, y: 700 },
  ]
  const H = homographyFromPairs(wall, photo)!
  const centre = applyHomography(H, { x: 3, y: 1.5 })
  // The big left side is the near end. Near metres take up more pixels, so the wall's
  // halfway point lands past the photo's halfway point, towards the small far side.
  assert.ok(centre.x > 500, `centre x ${centre.x} should be right of 500`)
})

test('three points on a line give no mapping', () => {
  const flat: Quad = [
    { x: 0, y: 0 }, { x: 1, y: 0 }, { x: 2, y: 0 }, { x: 0, y: 1 },
  ]
  const photo: Quad = [
    { x: 0, y: 0 }, { x: 10, y: 0 }, { x: 20, y: 0 }, { x: 0, y: 10 },
  ]
  assert.equal(homographyFromPairs(flat, photo), null)
})

test('a crossed, dented or flat photo quad gives no mapping', () => {
  const wall: Quad = [{ x: 0, y: 0 }, { x: 3000, y: 0 }, { x: 3000, y: 4000 }, { x: 0, y: 4000 }]
  const threeOnALine: Quad = [{ x: 100, y: 100 }, { x: 1100, y: 1100 }, { x: 2100, y: 2100 }, { x: 0, y: 3000 }]
  const bowTie: Quad = [{ x: 0, y: 0 }, { x: 100, y: 100 }, { x: 100, y: 0 }, { x: 0, y: 100 }]
  const dented: Quad = [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 30, y: 30 }, { x: 0, y: 100 }]
  assert.equal(homographyFromPairs(wall, threeOnALine), null)
  assert.equal(homographyFromPairs(wall, bowTie), null)
  assert.equal(homographyFromPairs(wall, dented), null)
})
