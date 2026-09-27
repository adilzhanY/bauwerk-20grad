import { test } from 'node:test'
import assert from 'node:assert/strict'
import { roofTypeLabel, buildingFunctionLabel, functionGroup, roofTypeCodes } from '../src/codelists.ts'

test('roof type codes decode to their AdV labels', () => {
  assert.equal(roofTypeLabel('1000'), 'Flachdach')
  assert.equal(roofTypeLabel('2100'), 'Pultdach')
  assert.equal(roofTypeLabel('3100'), 'Satteldach')
  assert.equal(roofTypeLabel('3200'), 'Walmdach')
  assert.equal(roofTypeLabel(null), null)
  assert.equal(roofTypeLabel('9999999'), null, 'unknown codes must not invent a label')
  assert.ok(Object.keys(roofTypeCodes).length >= 15)
})

test('building function codes decode to their ALKIS labels', () => {
  // The sample tile's DENW43AL00001j2X carries this code — a 35 m2 garage.
  assert.equal(buildingFunctionLabel('31001_2460'), 'Gebäude zum Parken')
  assert.equal(buildingFunctionLabel('31001_1010'), 'Wohnhaus')
  assert.equal(buildingFunctionLabel(null), null)
})

test('function grouping separates dwellings from everything else', () => {
  assert.equal(functionGroup('31001_1010'), 'residential')
  assert.equal(functionGroup('31001_1000'), 'residential')
  assert.equal(functionGroup('31001_2460'), 'commercial')
  assert.equal(functionGroup('51001_1010'), 'utility')
  assert.equal(functionGroup(null), 'other')
})
