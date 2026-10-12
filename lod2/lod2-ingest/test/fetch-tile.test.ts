import { test } from 'node:test'
import assert from 'node:assert/strict'
import { textOf } from '../src/fetch-tile.ts'

test('textOf slices a buffer without splitting a multi-byte character', async () => {
  const text = 'Straße ü'.repeat(5)
  const parts: string[] = []
  // 3 bytes per slice puts most slice boundaries inside an umlaut's two bytes.
  for await (const part of textOf(Buffer.from(text), 3)) parts.push(part)
  assert.ok(parts.length > 10)
  assert.equal(parts.join(''), text)
})
