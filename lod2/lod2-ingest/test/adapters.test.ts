import { test, mock } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { getAdapter, adapterCodes } from '../src/adapters/index.ts'
import { tileLockKey } from '../src/db.ts'

const fixture = (name: string) =>
  readFile(fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url)), 'utf8')

/** Serve a recorded index instead of hitting the real portal. */
function stubFetch(body: string, json?: unknown) {
  mock.method(globalThis, 'fetch', async () =>
    ({ ok: true, status: 200, text: async () => body, json: async () => json }) as Response)
}

test('Berlin: an ATOM feed decodes to 1 km tiles', async (t) => {
  stubFetch(await fixture('be-index.atom'))
  t.after(() => mock.restoreAll())

  const tiles = await getAdapter('BE').listTiles()
  assert.equal(tiles.length, 4)

  const first = tiles[0]!
  assert.equal(first.id, '371_5809')
  assert.deepEqual(first.bbox, { minX: 371_000, minY: 5_809_000, maxX: 372_000, maxY: 5_810_000 })
  assert.equal(first.url.endsWith('/LoD2_371_5809.zip'), true)
  assert.equal(first.sha256, null, 'Berlin publishes no hashes')
})

test('Berlin: unknown sizes are reported as zero, not guessed', async (t) => {
  stubFetch(await fixture('be-index.atom'))
  t.after(() => mock.restoreAll())

  // The feed has no <size>, and asking the server 924 times does not work — it answers 20
  // requests happily, sequential or parallel, and drops most of a full sweep. Zero is the
  // loader's "unknown": it guards the empty-tile skip with `sizeBytes > 0`, so a zero means
  // "fetch it and see" rather than "skip it".
  const be = getAdapter('BE')
  const tiles = await be.listTiles()
  assert.ok(tiles.every((x) => x.sizeBytes === 0))
  assert.equal(be.sizesAreApproximate, true)
  // A tile must not be mistaken for empty just because its size is unknown.
  assert.ok(tiles.every((x) => !(x.sizeBytes > 0 && x.sizeBytes <= be.emptyTileMaxBytes)))
})

test('Berlin: one feed date stands in for every tile', async (t) => {
  stubFetch(await fixture('be-index.atom'))
  t.after(() => mock.restoreAll())

  // The source offers nothing per file — one <updated> for the whole feed. Repeating it is
  // honest; inventing a date per tile would make change detection look sharper than it is.
  const tiles = await getAdapter('BE').listTiles()
  assert.ok(tiles.every((x) => x.sourceTs === '2026-03-26T11:55:12Z'))
})

test('Berlin: a tile outside the state is refused rather than placed', async (t) => {
  // The filename carries no UTM zone to check, so the extent guard is the only defence. A
  // Berlin tile read as zone 32 would sit 400 km west, and ST_Transform would carry that out
  // without complaint.
  const raw = await fixture('be-index.atom')
  stubFetch(raw.replace('LoD2_371_5809.zip', 'LoD2_271_5809.zip'))
  t.after(() => mock.restoreAll())

  await assert.rejects(() => getAdapter('BE').listTiles(), /outside the state/)
})

test('Berlin: the feed is a hard dependency, and a broken one is not silently empty', async (t) => {
  mock.method(globalThis, 'fetch', async () =>
    ({ ok: true, status: 200, text: async () => '<feed></feed>' }) as Response)
  t.after(() => mock.restoreAll())

  // An index that parses but yields nothing would otherwise look like "this state has no
  // tiles", and `lod2 index` would happily write an empty catalogue over a good one.
  await assert.rejects(() => getAdapter('BE').listTiles(), /yielded no tiles/)
})

test('Berlin: the imagery service states its vintage, having no queryable layer', () => {
  // `truedop_2026` answers no GetFeatureInfo, so there is no per-tile flight date to ask for.
  // The product year is coarser but true, and beats the "not stated" the panel would show.
  const service = getAdapter('BE').orthophoto!
  assert.equal(service.acquiredAt, '2026')
  assert.equal(service.trueOrtho, true)
  assert.equal(service.gsdM, 0.2)
  assert.equal(service.licence, 'dl-de/zero-2-0')
})

/**
 * States east of about 12 degrees are published in UTM zone 33, the rest in 32.
 *
 * This is the assertion that catches the realistic mistake when a state is added, which is
 * cloning an existing adapter and leaving its CRS behind: the data still parses, the tiles
 * still index, and every building lands a few hundred kilometres from where it belongs.
 */
const UTM33_STATES = new Set(['BE', 'BB', 'MV', 'SN', 'ST', 'TH'])

test('every adapter declares the CRS its state is published in, and its licence', () => {
  for (const code of adapterCodes) {
    const a = getAdapter(code)
    assert.equal(a.code, code, 'registry key and adapter code must agree')
    assert.equal(
      a.epsg,
      UTM33_STATES.has(code) ? 25833 : 25832,
      `${code} is in UTM${UTM33_STATES.has(code) ? 33 : 32}`,
    )
    // Attribution is a licence obligation, so assert it names one rather than merely being
    // non-empty.
    assert.match(a.attribution, /dl-de\/(by|zero)-2-0|CC BY/, `${code} must name its licence`)
    assert.ok(a.attribution.split(',')[0]!.trim().length > 3, `${code} must name its source`)
    assert.ok(a.tileSizeM > 0 && a.tileSizeM % 1000 === 0)
    assert.ok(a.emptyTileMaxBytes >= 0)
  }
})

test('unknown states fail loudly rather than silently doing nothing', () => {
  // Only Berlin is wired up. A typo, or a state nobody has written an adapter for, must not
  // read as "nothing to do here".
  assert.throws(() => getAdapter('NW'), /No adapter for state "NW"/)
  assert.throws(() => getAdapter('SL'), /No adapter for state "SL"/)
})

test('tile lock keys are stable, distinct, and fit a signed bigint', () => {
  // Two processes must derive the same advisory-lock key for the same tile, so that the CLI
  // and the API's on-demand fetcher never download one twice.
  const a = tileLockKey('BE', '389_5819')
  assert.equal(a, tileLockKey('BE', '389_5819'))
  assert.notEqual(a, tileLockKey('BE', '389_5820'))
  assert.notEqual(a, tileLockKey('BB', '389_5819'))
  assert.ok(a >= -(2n ** 63n) && a < 2n ** 63n)
})
