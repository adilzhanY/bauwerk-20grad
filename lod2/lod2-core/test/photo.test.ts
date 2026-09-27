import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  clampToImage,
  fitImage,
  fitImageWithMargin,
  initialCorners,
  insetCorners,
  loupeBackground,
  photoToScreen,
  screenToPhoto,
} from '../src/photo.ts'

test('a wide photo fits the box width and is centred vertically', () => {
  const fit = fitImage(4000, 2000, 1000, 800)
  assert.equal(fit.scale, 0.25)
  assert.equal(fit.width, 1000)
  assert.equal(fit.height, 500)
  assert.equal(fit.offsetX, 0)
  assert.equal(fit.offsetY, 150)
})

test('a tall photo fits the box height and is centred horizontally', () => {
  const fit = fitImage(1000, 4000, 1000, 800)
  assert.equal(fit.scale, 0.2)
  assert.equal(fit.width, 200)
  assert.equal(fit.height, 800)
  assert.equal(fit.offsetX, 400)
  assert.equal(fit.offsetY, 0)
})

test('a degenerate image or box gives a zero fit rather than NaN', () => {
  const fit = fitImage(0, 100, 500, 500)
  assert.equal(fit.scale, 0)
  assert.deepEqual(screenToPhoto({ x: 10, y: 10 }, fit), { x: 0, y: 0 })
})

test('photo to screen and back is a round trip', () => {
  const fit = fitImage(4000, 3000, 900, 700)
  const photo = { x: 1234.5, y: 678.9 }
  const back = screenToPhoto(photoToScreen(photo, fit), fit)
  assert.ok(Math.abs(back.x - photo.x) < 1e-9)
  assert.ok(Math.abs(back.y - photo.y) < 1e-9)
})

test('the image corners land on the drawn image corners', () => {
  const fit = fitImage(4000, 2000, 1000, 800)
  assert.deepEqual(photoToScreen({ x: 0, y: 0 }, fit), { x: 0, y: 150 })
  assert.deepEqual(photoToScreen({ x: 4000, y: 2000 }, fit), { x: 1000, y: 650 })
})

test('clamping keeps a dragged point inside the image', () => {
  assert.deepEqual(clampToImage({ x: -5, y: 50 }, 100, 80), { x: 0, y: 50 })
  assert.deepEqual(clampToImage({ x: 120, y: 90 }, 100, 80), { x: 100, y: 80 })
  assert.deepEqual(clampToImage({ x: 30, y: 40 }, 100, 80), { x: 30, y: 40 })
})

test('initial corners go clockwise from the top-left', () => {
  assert.deepEqual(initialCorners(100, 50), [
    { x: 0, y: 0 },
    { x: 100, y: 0 },
    { x: 100, y: 50 },
    { x: 0, y: 50 },
  ])
})

test('the loupe puts the chosen photo pixel in the middle of its window', () => {
  const loupe = loupeBackground({ x: 100, y: 50 }, 400, 300, 3, 140)
  assert.equal(loupe.backgroundWidth, 1200)
  assert.equal(loupe.backgroundHeight, 900)
  // Window centre is at 70; the point is drawn at 100 * 3 = 300 from the background's edge.
  assert.equal(loupe.backgroundX, 70 - 300)
  assert.equal(loupe.backgroundY, 70 - 150)
})

test('the loupe on the photo corner shows the corner at its centre', () => {
  const loupe = loupeBackground({ x: 0, y: 0 }, 400, 300, 2, 100)
  assert.equal(loupe.backgroundX, 50)
  assert.equal(loupe.backgroundY, 50)
})

test('inset corners sit a fraction inside each image corner, clockwise from the top left', () => {
  assert.deepEqual(insetCorners(1000, 500, 0.1), [
    { x: 100, y: 50 },
    { x: 900, y: 50 },
    { x: 900, y: 450 },
    { x: 100, y: 450 },
  ])
})

test('fitting with a margin keeps that many pixels free on every side', () => {
  // A 4000 by 2000 photo in a 1048 by 848 box with 24 px margins has 1000 by 800 to use.
  const fit = fitImageWithMargin(4000, 2000, 1048, 848, 24)
  assert.equal(fit.scale, 0.25)
  assert.equal(fit.offsetX, 24)
  assert.equal(fit.offsetY, 24 + 150)
  assert.ok(fit.offsetX + fit.width <= 1048 - 24)
  assert.ok(fit.offsetY + fit.height <= 848 - 24)
})

test('a box smaller than its margins gives a zero fit rather than a negative one', () => {
  assert.equal(fitImageWithMargin(4000, 2000, 40, 40, 24).scale, 0)
})
