import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  angleDifference,
  expectedWallFacing,
  readCompassDirection,
  readExifSummary,
  sizesMatchIgnoringRotation,
} from '../src/exif.ts'

const photo = (name: string) => new Uint8Array(readFileSync(new URL(`../../sample-photos/${name}.jpg`, import.meta.url)))
const near = (a: number, b: number, tol = 0.01) => Math.abs(a - b) <= tol

test('the three sample photos carry the compass directions the brief quotes', () => {
  const cases: Array<[string, number]> = [
    ['DEBE02YY40000BOo', 302.4],
    ['DEBE02YY40000Atr', 302.71],
    ['DEBE02YY400000kY', 113.14],
  ]
  for (const [name, expected] of cases) {
    const direction = readCompassDirection(photo(name))
    assert.ok(direction, `${name} has a direction`)
    assert.ok(near(direction.degrees, expected), `${name}: ${direction.degrees} vs ${expected}`)
    assert.equal(direction.ref, 'T')
  }
})

test('a JPEG without Exif, and a non-JPEG, give null', () => {
  const bareJpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xda, 0x00, 0x02])
  assert.equal(readCompassDirection(bareJpeg), null)
  assert.equal(readCompassDirection(new Uint8Array([0x89, 0x50, 0x4e, 0x47])), null)
})

test('a truncated Exif block gives null rather than throwing', () => {
  const whole = photo('DEBE02YY40000BOo')
  for (const length of [10, 30, 60, 120, 300]) {
    assert.equal(readCompassDirection(whole.subarray(0, length)), null, `cut at ${length}`)
  }
})

test('the wall the camera looks at faces back towards the camera', () => {
  assert.ok(near(expectedWallFacing(302.4), 122.4))
  assert.ok(near(expectedWallFacing(113.14), 293.14))
  assert.ok(near(expectedWallFacing(200), 20))
})

test('angle difference is the smallest way round', () => {
  assert.equal(angleDifference(355, 5), 10)
  assert.equal(angleDifference(5, 355), 10)
  assert.equal(angleDifference(0, 180), 180)
  assert.ok(near(angleDifference(122.4, 114), 8.4))
})

test('the summary reads camera, exposure and location from a sample photo', () => {
  const summary = readExifSummary(photo('DEBE02YY40000BOo'))
  assert.ok(summary)
  assert.equal(summary.make, 'Apple')
  assert.equal(summary.model, 'iPhone 17')
  assert.equal(summary.dateTaken, '2026-08-20 15:19:11')
  assert.equal(summary.focalLength35mm, 14)
  assert.ok(near(summary.focalLengthMm!, 2.22))
  assert.ok(near(summary.fNumber!, 2.2))
  assert.equal(Math.round(1 / summary.exposureSeconds!), 631)
  assert.equal(summary.orientation, 1)
  // The Exif block claims a landscape size, although the stored image is portrait.
  assert.deepEqual([summary.pixelWidth, summary.pixelHeight], [5712, 4284])
  // 52° 29' 21.14" N and 13° 23' 7.27" E.
  assert.ok(near(summary.latitude!, 52 + 29 / 60 + 21.14 / 3600, 1e-6))
  assert.ok(near(summary.longitude!, 13 + 23 / 60 + 7.27 / 3600, 1e-6))
  assert.ok(summary.altitudeM !== null && summary.altitudeM > 0)
  assert.ok(summary.direction && near(summary.direction.degrees, 302.4))
})

test('all three sample photos report the 14 mm equivalent lens the brief quotes', () => {
  for (const name of ['DEBE02YY40000BOo', 'DEBE02YY40000Atr', 'DEBE02YY400000kY']) {
    const summary = readExifSummary(photo(name))
    assert.ok(summary, `${name} has Exif`)
    assert.equal(summary.focalLength35mm, 14, name)
  }
})

test('the summary is null without Exif and never throws on a truncated block', () => {
  assert.equal(readExifSummary(new Uint8Array([0xff, 0xd8, 0xff, 0xda, 0x00, 0x02])), null)
  const whole = photo('DEBE02YY40000BOo')
  for (const length of [10, 30, 60, 120, 300, 2000]) {
    assert.doesNotThrow(() => readExifSummary(whole.subarray(0, length)), `cut at ${length}`)
  }
})

test('a size and the same size rotated count as a match, a different size does not', () => {
  assert.equal(sizesMatchIgnoringRotation(4000, 3000, 4000, 3000), true)
  assert.equal(sizesMatchIgnoringRotation(4000, 3000, 3000, 4000), true)
  assert.equal(sizesMatchIgnoringRotation(4000, 3000, 4000, 2250), false)
  assert.equal(sizesMatchIgnoringRotation(4000, 3000, 2250, 4000), false)
})

test('the BOo photo states its size the landscape way round, which is not a mismatch', () => {
  const summary = readExifSummary(photo('DEBE02YY40000BOo'))!
  // The stored image decodes as 4284 by 5712, portrait.
  assert.equal(sizesMatchIgnoringRotation(summary.pixelWidth!, summary.pixelHeight!, 4284, 5712), true)
})

test('the expected wall facing is always a bearing from 0 to 360', () => {
  assert.ok(near(expectedWallFacing(-200), 340))
  assert.ok(near(expectedWallFacing(180), 0))
})
