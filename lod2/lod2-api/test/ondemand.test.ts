import { test } from 'node:test'
import assert from 'node:assert/strict'
import type pg from 'pg'
import type { StateAdapter, TileRef } from 'lod2-core'
import type { LoadTileResult } from 'lod2-ingest/load'
import { OnDemandFetcher } from '../src/ondemand.ts'

const adapter = { code: 'BE' } as StateAdapter
const pool = {} as pg.Pool

/** Each tile on its own host, and each test on its own tiles, so the shared pacer never makes one wait. */
const tiles = (from: number, n: number): TileRef[] =>
  Array.from({ length: n }, (_, i) => ({
    id: `t${from + i}`, url: `https://h${from + i}.ondemand.test/t.zip`, sizeBytes: 1, sha256: null,
    bbox: { minX: 0, minY: 0, maxX: 1, maxY: 1 }, sourceTs: null,
  }))

/** A download that only ends when its signal aborts. */
const hanging = (_p: pg.Pool, _a: StateAdapter, tile: TileRef, opts: { signal?: AbortSignal } = {}) =>
  new Promise<LoadTileResult>((resolve) => {
    opts.signal?.addEventListener('abort', () =>
      resolve({ tileId: tile.id, status: 'skipped', buildings: 0, parts: 0, ms: 0 }))
  })

test('caps each request and the queue, and drops the excess', async () => {
  const fetcher = new OnDemandFetcher(pool, hanging)
  // 8 per request: the two past that are dropped.
  assert.equal(fetcher.enqueue(adapter, tiles(0, 10)).dropped, 2)
  for (let i = 1; i < 9; i++) fetcher.enqueue(adapter, tiles(i * 8, 8))
  // 2 downloading and the queue full at 64; the 9th batch could only place what fitted.
  assert.equal(fetcher.pendingCount, 66)
  const full = fetcher.enqueue(adapter, tiles(100, 8))
  assert.deepEqual(full.queued, [])
  assert.equal(full.dropped, 8)
  await fetcher.stop(10)
})

test('a tile already queued or downloading is not queued twice', async () => {
  const fetcher = new OnDemandFetcher(pool, hanging)
  fetcher.enqueue(adapter, tiles(200, 4))
  const again = fetcher.enqueue(adapter, tiles(200, 4))
  assert.deepEqual(again.queued, [])
  assert.equal(again.dropped, 0)
  assert.equal(fetcher.pendingCount, 4)
  await fetcher.stop(10)
})

test('stop drops the queue, aborts downloads after the wait, and refuses new work', async () => {
  const fetcher = new OnDemandFetcher(pool, hanging)
  fetcher.enqueue(adapter, tiles(300, 5))
  // Let the two downloads start, so stop has something to abort.
  await new Promise((resolve) => setImmediate(resolve))
  await fetcher.stop(10)
  assert.equal(fetcher.pendingCount, 0)
  const after = fetcher.enqueue(adapter, tiles(10, 3))
  assert.deepEqual(after.queued, [])
  assert.equal(after.dropped, 3)
})
