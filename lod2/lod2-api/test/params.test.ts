import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  DEFAULT_CORS_ORIGINS, escapeLike, isLonLat, isValidGid, parseBBox, parseCorsOrigins, parseMaxPx,
  parseNeighbourBox, singleParam,
} from '../src/params.ts'

test('singleParam keeps a string and drops arrays and absent values', () => {
  assert.equal(singleParam('abc'), 'abc')
  assert.equal(singleParam(''), '')
  assert.equal(singleParam(['a', 'b']), undefined)
  assert.equal(singleParam(undefined), undefined)
  assert.equal(singleParam(42), undefined)
})

test('isValidGid accepts AdV ids and rejects anything else', () => {
  assert.ok(isValidGid('DEBE01YYK00002Gu'))
  assert.ok(isValidGid('a.b_c-1'))
  assert.ok(isValidGid('x'.repeat(64)))
  assert.ok(!isValidGid(''))
  assert.ok(!isValidGid(`a${String.fromCharCode(0)}b`))
  assert.ok(!isValidGid('a b'))
  assert.ok(!isValidGid('a%'))
  assert.ok(!isValidGid('x'.repeat(65)))
})

test('escapeLike escapes the LIKE wildcards and the escape character', () => {
  assert.equal(escapeLike('DEBE01'), 'DEBE01')
  assert.equal(escapeLike('a%b_c'), 'a\\%b\\_c')
  assert.equal(escapeLike('a\\b'), 'a\\\\b')
})

test('parseNeighbourBox defaults, accepts the range, rejects the rest', () => {
  assert.equal(parseNeighbourBox(undefined), 800)
  assert.equal(parseNeighbourBox('300'), 300)
  assert.equal(parseNeighbourBox('20'), 20)
  assert.equal(parseNeighbourBox('1200'), 1200)
  assert.equal(parseNeighbourBox(''), null)
  assert.equal(parseNeighbourBox('  '), null)
  assert.equal(parseNeighbourBox('NaN'), null)
  assert.equal(parseNeighbourBox('abc'), null)
  assert.equal(parseNeighbourBox('Infinity'), null)
  assert.equal(parseNeighbourBox('-5'), null)
  assert.equal(parseNeighbourBox('19'), null)
  assert.equal(parseNeighbourBox('1201'), null)
})

test('parseMaxPx allows a fixed set and folds large values into the hard cap', () => {
  assert.equal(parseMaxPx(undefined), undefined)
  assert.equal(parseMaxPx('2048'), 2048)
  assert.equal(parseMaxPx('4096'), 4096)
  assert.equal(parseMaxPx('8000'), 4096)
  assert.equal(parseMaxPx('2047'), null)
  assert.equal(parseMaxPx('16'), null)
  assert.equal(parseMaxPx('abc'), null)
  assert.equal(parseMaxPx('1024.5'), null)
})

test('parseBBox needs four finite numbers', () => {
  assert.deepEqual(parseBBox('1,2,3,4'), [1, 2, 3, 4])
  assert.equal(parseBBox(undefined), null)
  assert.equal(parseBBox('1,2,3'), null)
  assert.equal(parseBBox('1,2,3,x'), null)
})

test('parseCorsOrigins splits a list and falls back to the local viewer', () => {
  assert.deepEqual(parseCorsOrigins(undefined), DEFAULT_CORS_ORIGINS)
  assert.deepEqual(parseCorsOrigins(''), DEFAULT_CORS_ORIGINS)
  assert.deepEqual(parseCorsOrigins('https://a.test, https://b.test'), ['https://a.test', 'https://b.test'])
})

test('isLonLat accepts coordinates in range only', () => {
  assert.equal(isLonLat(13.38, 52.49), true)
  assert.equal(isLonLat(181, 52), false)
  assert.equal(isLonLat(Number.NaN, 52), false)
})
