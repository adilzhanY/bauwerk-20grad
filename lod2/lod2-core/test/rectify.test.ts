import { test } from 'node:test'
import assert from 'node:assert/strict'
import { metricSize, previewSize, rectifyImage, wallCornersInMetres, type RgbaImage } from '../src/rectify.ts'
import type { Quad } from '../src/photo.ts'

/** A 2x2 photo with four distinct solid colours. */
const photo: RgbaImage = {
  width: 2,
  height: 2,
  data: new Uint8ClampedArray([
    255, 0, 0, 255,   0, 255, 0, 255,   // top row: red, green
    0, 0, 255, 255,   255, 255, 0, 255, // bottom row: blue, yellow
  ]),
}

const pixel = (img: RgbaImage, x: number, y: number) => {
  const i = (y * img.width + x) * 4
  return Array.from(img.data.slice(i, i + 4))
}

test('an identity mapping copies the photo pixel for pixel', () => {
  const corners: Quad = [
    { x: 0, y: 0 }, { x: 2, y: 0 }, { x: 2, y: 2 }, { x: 0, y: 2 },
  ]
  const out = rectifyImage(photo, corners, 2, 2)
  assert.ok(out)
  assert.deepEqual(pixel(out, 0, 0), [255, 0, 0, 255])
  assert.deepEqual(pixel(out, 1, 0), [0, 255, 0, 255])
  assert.deepEqual(pixel(out, 0, 1), [0, 0, 255, 255])
  assert.deepEqual(pixel(out, 1, 1), [255, 255, 0, 255])
})

test('swapping left and right corners mirrors the photo', () => {
  const corners: Quad = [
    { x: 2, y: 0 }, { x: 0, y: 0 }, { x: 0, y: 2 }, { x: 2, y: 2 },
  ]
  const out = rectifyImage(photo, corners, 2, 2)!
  assert.deepEqual(pixel(out, 0, 0), [0, 255, 0, 255])
  assert.deepEqual(pixel(out, 1, 0), [255, 0, 0, 255])
})

test('output pixels that fall outside the photo stay transparent', () => {
  const corners: Quad = [
    { x: -2, y: 0 }, { x: 2, y: 0 }, { x: 2, y: 2 }, { x: -2, y: 2 },
  ]
  const out = rectifyImage(photo, corners, 4, 2)!
  assert.deepEqual(pixel(out, 0, 0), [0, 0, 0, 0])
  assert.deepEqual(pixel(out, 2, 0), [255, 0, 0, 255])
})

test('wall corners in metres follow the dot order, top-left first', () => {
  assert.deepEqual(wallCornersInMetres(6, 3), [
    { x: 0, y: 3 }, { x: 6, y: 3 }, { x: 6, y: 0 }, { x: 0, y: 0 },
  ])
})

test('the preview keeps the wall aspect ratio inside its box', () => {
  assert.deepEqual(previewSize(12, 6, 320, 320), { width: 320, height: 160 })
  assert.deepEqual(previewSize(4, 8, 320, 240), { width: 120, height: 240 })
  assert.deepEqual(previewSize(0, 8, 320, 240), { width: 0, height: 0 })
})

test('bilinear sampling at the exact middle averages the four colours', () => {
  // A 1x1 output whose centre maps to the photo centre (1, 1), between all four pixels.
  const corners: Quad = [
    { x: 0.5, y: 0.5 }, { x: 1.5, y: 0.5 }, { x: 1.5, y: 1.5 }, { x: 0.5, y: 1.5 },
  ]
  const out = rectifyImage(photo, corners, 1, 1, 'bilinear')!
  // red, green, blue, yellow averaged: (255+0+0+255)/4, (0+255+0+255)/4, (0+0+255+0)/4
  assert.deepEqual(pixel(out, 0, 0), [128, 128, 64, 255])
})

test('bilinear sampling on an exact pixel centre returns that pixel', () => {
  const corners: Quad = [
    { x: 0, y: 0 }, { x: 2, y: 0 }, { x: 2, y: 2 }, { x: 0, y: 2 },
  ]
  const out = rectifyImage(photo, corners, 2, 2, 'bilinear')!
  assert.deepEqual(pixel(out, 0, 0), [255, 0, 0, 255])
  assert.deepEqual(pixel(out, 1, 1), [255, 255, 0, 255])
})

test('metric size is the wall in centimetres at 100 px per metre', () => {
  assert.deepEqual(metricSize(21.6, 18, 100), { width: 2160, height: 1800 })
})

test('rectifying refuses a size that is not a whole number of pixels', () => {
  const photo: RgbaImage = { width: 2, height: 2, data: new Uint8ClampedArray(16) }
  const corners: Quad = [{ x: 0, y: 0 }, { x: 2, y: 0 }, { x: 2, y: 2 }, { x: 0, y: 2 }]
  assert.equal(rectifyImage(photo, corners, 2.5, 2), null)
  assert.equal(rectifyImage(photo, corners, 0, 2), null)
})
