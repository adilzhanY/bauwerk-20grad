import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  clampOpening,
  defaultOpening,
  duplicateOpening,
  imageToWall,
  moveOpening,
  resizeHandleAt,
  resizeOpening,
  resizeOpeningByHandle,
  openingArea,
  openingContains,
  openingCenteredAt,
  openingFromDrag,
  openingsSummary,
  totalOpeningArea,
  wallToImage,
  windowToWallRatio,
} from '../src/openings.ts'

const near = (a: number, b: number) => Math.abs(a - b) < 1e-9

test('the bottom-left image pixel is the wall origin, and the top-left is wall height', () => {
  // A 6 m by 3 m wall at 100 px per metre is a 600 by 300 image.
  assert.deepEqual(imageToWall({ x: 0, y: 300 }, 300, 100), { x: 0, y: 0 })
  assert.deepEqual(imageToWall({ x: 0, y: 0 }, 300, 100), { x: 0, y: 3 })
  assert.deepEqual(imageToWall({ x: 600, y: 300 }, 300, 100), { x: 6, y: 0 })
})

test('image to wall and back is a round trip', () => {
  const pixel = { x: 123, y: 45 }
  const back = wallToImage(imageToWall(pixel, 300, 100), 300, 100)
  assert.ok(near(back.x, pixel.x) && near(back.y, pixel.y))
})

test('a drag gives the same rectangle whichever corner it starts from', () => {
  const a = openingFromDrag({ x: 1, y: 1 }, { x: 2.2, y: 2.5 })
  const b = openingFromDrag({ x: 2.2, y: 2.5 }, { x: 1, y: 1 })
  assert.deepEqual(a, b)
  assert.ok(near(a.x, 1) && near(a.y, 1) && near(a.width, 1.2) && near(a.height, 1.5))
})

test('opening area is width times height in square metres', () => {
  assert.ok(near(openingArea({ x: 0, y: 0, width: 1.2, height: 1.5 }), 1.8))
})

test('two openings on a 6 by 3 wall give a window-to-wall ratio of 0.2', () => {
  const openings = [
    { x: 1, y: 1, width: 1.2, height: 1.5 },
    { x: 3.5, y: 1, width: 1.2, height: 1.5 },
  ]
  assert.ok(near(totalOpeningArea(openings), 3.6))
  assert.ok(near(windowToWallRatio(openings, 6, 3)!, 0.2))
})

test('a wall with no area has no ratio', () => {
  assert.equal(windowToWallRatio([], 0, 3), null)
})

test('a point inside an opening is found, one outside is not', () => {
  const o = { x: 1, y: 1, width: 1, height: 1 }
  assert.equal(openingContains(o, { x: 1.5, y: 1.5 }), true)
  assert.equal(openingContains(o, { x: 2, y: 2 }), true)
  assert.equal(openingContains(o, { x: 2.1, y: 1.5 }), false)
})

test('moving and resizing change only what they should', () => {
  const o = { x: 1, y: 1, width: 1.2, height: 1.5 }
  assert.deepEqual(moveOpening(o, 0.5, -0.25), { x: 1.5, y: 0.75, width: 1.2, height: 1.5 })
  assert.deepEqual(resizeOpening(o, 2, 1), { x: 1, y: 1, width: 2, height: 1 })
})

test('clamping slides an opening back inside the wall and shrinks one that is too big', () => {
  assert.deepEqual(clampOpening({ x: 5.5, y: -1, width: 1, height: 1 }, 6, 3), { x: 5, y: 0, width: 1, height: 1 })
  assert.deepEqual(clampOpening({ x: 0, y: 0, width: 10, height: 1 }, 6, 3), { x: 0, y: 0, width: 6, height: 1 })
})

test('the default opening sits in the middle of the wall', () => {
  const o = defaultOpening(6, 3)
  assert.ok(near(o.x + o.width / 2, 3) && near(o.y + o.height / 2, 1.5))
  assert.ok(near(o.width, 1.2) && near(o.height, 1.5))
})

test('a duplicate goes to the right, or to the next row when the wall ends', () => {
  const o = { x: 1, y: 1, width: 1, height: 1 }
  assert.deepEqual(duplicateOpening(o, 0.2, 6, 3), { x: 2.2, y: 1, width: 1, height: 1 })
  const atEdge = { x: 4.5, y: 2, width: 1, height: 0.5 }
  assert.deepEqual(duplicateOpening(atEdge, 0.2, 6, 3), { x: 0, y: 1.3, width: 1, height: 0.5 })
})

test('the summary counts openings and reports area and ratio against the model wall area', () => {
  const openings = [
    { x: 1, y: 1, width: 1.2, height: 1.5 },
    { x: 3.5, y: 1, width: 1.2, height: 1.5 },
  ]
  const summary = openingsSummary(openings, 18)
  assert.equal(summary.count, 2)
  assert.ok(near(summary.openingArea, 3.6))
  assert.equal(summary.wallArea, 18)
  assert.ok(near(summary.ratio!, 0.2))
  assert.equal(openingsSummary([], 0).ratio, null)
})

// A 1.2 m by 1.5 m window with its bottom-left corner at (1, 1).
const windowAt = { x: 1, y: 1, width: 1.2, height: 1.5 }
const assertOpeningNear = (got: { x: number; y: number; width: number; height: number }, want: typeof got) => {
  for (const key of ['x', 'y', 'width', 'height'] as const) {
    assert.ok(near(got[key], want[key]), `${key}: ${got[key]} vs ${want[key]}`)
  }
}

test('a grab in a corner zone controls that corner, an edge zone controls one edge', () => {
  // Top right corner zone: near x = 2.2, y = 2.5.
  assert.deepEqual(resizeHandleAt(windowAt, { x: 2.1, y: 2.4 }), { x: 1, y: 1 })
  // Right edge, vertically in the middle third.
  assert.deepEqual(resizeHandleAt(windowAt, { x: 2.1, y: 1.75 }), { x: 1, y: 0 })
  // Bottom edge, horizontally in the middle third.
  assert.deepEqual(resizeHandleAt(windowAt, { x: 1.6, y: 1.1 }), { x: 0, y: -1 })
})

test('a grab in the centre zone controls the nearest corner', () => {
  // Just left of and below the middle (1.6, 1.75).
  assert.deepEqual(resizeHandleAt(windowAt, { x: 1.55, y: 1.7 }), { x: -1, y: -1 })
  assert.deepEqual(resizeHandleAt(windowAt, { x: 1.65, y: 1.8 }), { x: 1, y: 1 })
})

test('dragging a corner moves two edges and keeps the opposite corner fixed', () => {
  const got = resizeOpeningByHandle(windowAt, { x: 1, y: 1 }, 0.3, 0.2, 0.05)
  assertOpeningNear(got, { x: 1, y: 1, width: 1.5, height: 1.7 })
})

test('dragging an edge changes only that side', () => {
  const got = resizeOpeningByHandle(windowAt, { x: 0, y: -1 }, 0.4, -0.25, 0.05)
  assertOpeningNear(got, { x: 1, y: 0.75, width: 1.2, height: 1.75 })
})

test('dragging an edge past the opposite one flips the opening', () => {
  // Right edge dragged 2 m left: from x = 2.2 to 0.2, past the left edge at 1.
  const got = resizeOpeningByHandle(windowAt, { x: 1, y: 0 }, -2, 0, 0.05)
  assertOpeningNear(got, { x: 0.2, y: 1, width: 0.8, height: 1.5 })
})

test('a resized opening never gets smaller than the minimum', () => {
  // Right edge dragged exactly onto the left edge.
  const got = resizeOpeningByHandle(windowAt, { x: 1, y: 0 }, -1.2, 0, 0.05)
  assert.ok(near(got.width, 0.05), `width ${got.width}`)
  assert.ok(near(got.x, 1), 'the left edge, which was not dragged, stays put')
})

test('a nearly collapsed opening keeps its fixed edge inside the wall', () => {
  const box = { x: 0, y: 0, width: 1, height: 1 }
  const got = resizeOpeningByHandle(box, { x: 1, y: 0 }, -0.95, 0, 0.2)
  assertOpeningNear(got, { x: 0, y: 0, width: 0.2, height: 1 })
})

test('a duplicate never lands on top of the original', () => {
  // No room to the right, no room below: the copy goes one row above.
  const low = { x: 0.2, y: 0.5, width: 1.2, height: 1 }
  assertOpeningNear(duplicateOpening(low, 0.2, 2.5, 3)!, { x: 0, y: 1.7, width: 1.2, height: 1 })
  // No free row at all on a small wall.
  assert.equal(duplicateOpening({ x: 0.2, y: 0.5, width: 1.2, height: 1.5 }, 0.5, 2.5, 3), null)
})

test('a pasted opening is centred on the point and kept inside the wall', () => {
  assertOpeningNear(openingCenteredAt(windowAt, { x: 3, y: 1.5 }, 6, 3), { x: 2.4, y: 0.75, width: 1.2, height: 1.5 })
  // Near the top right corner of a 6 by 3 wall it slides back inside.
  assertOpeningNear(openingCenteredAt(windowAt, { x: 5.9, y: 2.9 }, 6, 3), { x: 4.8, y: 1.5, width: 1.2, height: 1.5 })
})

test('clamping a detected opening keeps its confidence', () => {
  const detected = { x: 5.5, y: -1, width: 1, height: 1, score: 0.82 }
  assert.deepEqual(clampOpening(detected, 6, 3), { x: 5, y: 0, width: 1, height: 1, score: 0.82 })
  assert.equal(clampOpening({ x: 0, y: 0, width: 1, height: 2, kind: 'door' }, 6, 3).kind, 'door')
  // A hand-drawn opening stays without a score.
  assert.equal('score' in clampOpening({ x: 0, y: 0, width: 1, height: 1 }, 6, 3), false)
})
