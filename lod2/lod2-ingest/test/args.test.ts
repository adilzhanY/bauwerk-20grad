import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  parseArgs, parseBbox, parseLonLat, parseNumberList, parsePositiveInt, parsePositiveNumber,
  valueOf,
} from '../src/args.ts'
import { isRetryableStatus } from '../src/fetch-tile.ts'

test('parseArgs reads positional words, inline values, spaced values and bare flags', () => {
  const args = parseArgs(['tiles', '--state', 'BE', '--limit=5', '--dry-run'])
  assert.deepEqual(args._, ['tiles'])
  assert.equal(args.state, 'BE')
  assert.equal(args.limit, '5')
  assert.equal(args['dry-run'], true)
})

test('valueOf rejects an option given without a value', () => {
  const args = parseArgs(['tiles', '--limit', '--force'])
  assert.throws(() => valueOf(args, 'limit'), /--limit needs a value/)
  assert.equal(valueOf(args, 'concurrency'), undefined)
})

test('parseBbox accepts four ordered numbers', () => {
  assert.deepEqual(parseBbox('13.37,52.51,13.39,52.52', '--bbox-wgs84'), {
    minX: 13.37, minY: 52.51, maxX: 13.39, maxY: 52.52,
  })
})

test('parseBbox rejects the wrong count, non numbers and reversed corners', () => {
  assert.throws(() => parseBbox('1,2,3', '--bbox'), /exactly 4/)
  assert.throws(() => parseBbox('1,2,3,4,5', '--bbox'), /exactly 4/)
  assert.throws(() => parseBbox('1,x,3,4', '--bbox'), /exactly 4/)
  assert.throws(() => parseBbox('1,,3,4', '--bbox'), /exactly 4/)
  assert.throws(() => parseBbox('1,2,Infinity,4', '--bbox'), /exactly 4/)
  assert.throws(() => parseBbox('3,2,1,4', '--bbox'), /min < max/)
  assert.throws(() => parseBbox('1,4,3,4', '--bbox'), /min < max/)
})

test('parseLonLat needs two finite numbers', () => {
  assert.deepEqual(parseLonLat('13.4,52.5', '--around'), { lon: 13.4, lat: 52.5 })
  assert.throws(() => parseLonLat('13.4', '--around'), /exactly 2/)
  assert.throws(() => parseLonLat('13.4,NaN', '--around'), /exactly 2/)
})

test('parseNumberList names the flag in its error', () => {
  assert.throws(() => parseNumberList('a', 1, '--thing'), /--thing/)
})

test('parsePositiveInt accepts whole numbers of at least 1', () => {
  assert.equal(parsePositiveInt(undefined, 3, '--concurrency'), 3)
  assert.equal(parsePositiveInt('8', 3, '--concurrency'), 8)
  for (const bad of ['0', '-1', '2.5', 'abc', '', ' ', '1e999']) {
    assert.throws(() => parsePositiveInt(bad, 3, '--limit'), /--limit must be a positive whole number/)
  }
})

test('parsePositiveNumber accepts finite numbers above zero', () => {
  assert.equal(parsePositiveNumber(undefined, 1, '--radius-km'), 1)
  assert.equal(parsePositiveNumber('0.5', 1, '--radius-km'), 0.5)
  for (const bad of ['0', '-2', 'x', '', 'Infinity']) {
    assert.throws(() => parsePositiveNumber(bad, 1, '--radius-km'), /--radius-km/)
  }
})

test('isRetryableStatus retries server errors, timeouts and rate limits only', () => {
  for (const status of [500, 502, 503, 408, 429]) assert.equal(isRetryableStatus(status), true)
  for (const status of [400, 401, 403, 404, 410]) assert.equal(isRetryableStatus(status), false)
})
