import { test } from 'node:test'
import assert from 'node:assert/strict'
import { catalogueWindows, estimatePv, isSuitable, orientationFactor, BERLIN_YIELD, PEAK_PER_M2, USABLE_SHARE } from '../src/survey/index.ts'

const near = (a: number, b: number, eps = 1e-6) => Math.abs(a - b) <= eps

test('a south roof at 30 degrees is the reference, east and west lose about a fifth', () => {
  assert.ok(near(orientationFactor(180, 30), 1))
  assert.ok(near(orientationFactor(90, 30), 0.8))
  assert.ok(near(orientationFactor(270, 30), 0.8))
  // A flat module does not care where it faces.
  assert.ok(near(orientationFactor(null, 0), 0.89))
  assert.ok(orientationFactor(180, 60) < 1)
})

test('north slopes and steep planes are left out, flat roofs count', () => {
  assert.equal(isSuitable({ area: 50, azimuth: 0, tilt: 40 }), false)
  assert.equal(isSuitable({ area: 50, azimuth: 180, tilt: 75 }), false)
  assert.equal(isSuitable({ area: 50, azimuth: null, tilt: 0 }), true)
})

test('a 100 m² south roof gives about 14 kWp and 13 MWh a year', () => {
  const pv = estimatePv([{ area: 100, azimuth: 180, tilt: 30 }])
  assert.ok(near(pv.usableArea, 100 * USABLE_SHARE))
  assert.ok(near(pv.peakPower, 100 * USABLE_SHARE * PEAK_PER_M2))
  assert.ok(near(pv.yearlyYield, pv.peakPower * BERLIN_YIELD))
  assert.equal(pv.monthlyYield.length, 12)
  assert.ok(near(pv.monthlyYield.reduce((s, v) => s + v, 0), pv.yearlyYield, 1e-6))
  // Summer months carry most of it.
  assert.ok(pv.monthlyYield[5]! > pv.monthlyYield[11]! * 4)
})

test('catalogue windows take 55 percent of the wall, clear height minus 1.50 m high', () => {
  const windows = catalogueWindows(10, 3.2)
  const width = windows.reduce((s, w) => s + w.width, 0)
  assert.ok(near(width, 5.5, 0.01), `${width}`)
  for (const w of windows) {
    assert.ok(near(w.height, 3.2 - 0.3 - 1.5, 0.001))
    assert.ok(w.offset >= 0 && w.offset + w.width <= 10)
    assert.ok(w.sill + w.height <= 3.2)
  }
  assert.deepEqual(catalogueWindows(1, 3), [])
  assert.deepEqual(catalogueWindows(10, 2.2), [])
})
