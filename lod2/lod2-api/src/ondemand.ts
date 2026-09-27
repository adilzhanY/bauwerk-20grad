/**
 * On-demand source-tile ingestion.
 *
 * Panning the map turns into requests against a public authority server (gdi.berlin.de).
 * Every limit in here is a correctness requirement rather than polish: without them a single
 * zoomed-out pan would enqueue hundreds of multi-megabyte downloads and earn an IP block.
 *
 *   - nothing is fetched below MIN_ZOOM, where a viewport spans hundreds of tiles
 *   - at most MAX_PER_REQUEST tiles are enqueued per map request
 *   - the queue is bounded; excess is dropped and reported, never silently buffered
 *   - requests to one upstream host are spaced by the shared host pacer
 *   - every download is abandoned after DOWNLOAD_TIMEOUT_MS
 *   - a Postgres advisory lock (inside loadTile) stops two processes duplicating work
 */
import type pg from 'pg'
import type { StateAdapter, TileRef } from 'lod2-core'
import { loadTile } from 'lod2-ingest/load'
import { upstreamPacer } from './host-pacer.ts'

export const MIN_ZOOM = 14
const MAX_PER_REQUEST = 8
const MAX_QUEUE = 64
const MAX_CONCURRENT = 2
const DOWNLOAD_TIMEOUT_MS = 120_000
/** A 'fetching' row older than this belongs to a process that died mid download. */
const STALE_FETCHING_MINUTES = 10

interface Job {
  key: string
  adapter: StateAdapter
  tile: TileRef
}

export interface EnqueueResult {
  queued: string[]
  /** Tiles that matched but were dropped because the queue is full. */
  dropped: number
  pending: number
}

export class OnDemandFetcher {
  readonly #pool: pg.Pool
  readonly #queue: Job[] = []
  readonly #inFlight = new Set<string>()
  /** Aborts in-flight downloads when the server shuts down. */
  readonly #shutdown = new AbortController()
  #running = 0
  #stopped = false
  #onIdle: (() => void) | null = null

  constructor(pool: pg.Pool) {
    this.#pool = pool
  }

  get pendingCount(): number {
    return this.#queue.length + this.#inFlight.size
  }

  /** Tiles currently queued or downloading, for the coverage layer. */
  pendingKeys(): string[] {
    return [...this.#inFlight, ...this.#queue.map((j) => j.key)]
  }

  enqueue(adapter: StateAdapter, tiles: TileRef[]): EnqueueResult {
    const queued: string[] = []
    let dropped = 0
    if (this.#stopped) return { queued, dropped: tiles.length, pending: this.pendingCount }

    for (const tile of tiles.slice(0, MAX_PER_REQUEST)) {
      const key = `${adapter.code}/${tile.id}`
      if (this.#inFlight.has(key) || this.#queue.some((j) => j.key === key)) continue
      if (this.#queue.length >= MAX_QUEUE) {
        dropped++
        continue
      }
      this.#queue.push({ key, adapter, tile })
      queued.push(tile.id)
    }
    dropped += Math.max(0, tiles.length - MAX_PER_REQUEST)

    this.#pump()
    return { queued, dropped, pending: this.pendingCount }
  }

  #pump(): void {
    while (this.#running < MAX_CONCURRENT && this.#queue.length > 0) {
      const job = this.#queue.shift()!
      this.#running++
      this.#inFlight.add(job.key)
      void this.#run(job).finally(() => {
        this.#running--
        this.#inFlight.delete(job.key)
        this.#pump()
        if (this.#running === 0) this.#onIdle?.()
      })
    }
  }

  /**
   * Stop taking jobs, drop the queue, and wait for in-flight downloads to finish. After
   * timeoutMs they are aborted, and this waits once more for them to release their clients.
   */
  async stop(timeoutMs: number): Promise<void> {
    this.#stopped = true
    this.#queue.length = 0
    const finished = await this.#waitForIdle(timeoutMs)
    if (finished) return
    this.#shutdown.abort()
    await this.#waitForIdle(timeoutMs)
  }

  #waitForIdle(timeoutMs: number): Promise<boolean> {
    if (this.#running === 0) return Promise.resolve(true)
    return new Promise((resolve) => {
      const timer = setTimeout(() => resolve(false), timeoutMs)
      this.#onIdle = () => {
        clearTimeout(timer)
        resolve(true)
      }
    })
  }

  async #run(job: Job): Promise<void> {
    await upstreamPacer.wait(job.tile.url)
    if (this.#stopped) return

    const signal = AbortSignal.any([AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS), this.#shutdown.signal])
    try {
      const res = await loadTile(this.#pool, job.adapter, job.tile, { skipUnchanged: true, signal })
      if (res.status === 'failed') {
        console.warn(`on-demand ${job.key} failed: ${res.error}`)
      }
    } catch (err) {
      console.warn(`on-demand ${job.key} threw: ${(err as Error).message}`)
    }
  }
}

/**
 * Put tiles left in 'fetching' by a crashed process back in line.
 *
 * Only rows older than STALE_FETCHING_MINUTES, since a CLI run may be downloading right now.
 * Returns how many rows were reset.
 */
export async function resetStaleFetching(pool: pg.Pool): Promise<number> {
  const res = await pool.query(
    `UPDATE tile_status SET status = 'unfetched'
      WHERE status = 'fetching'
        AND (requested_at IS NULL OR requested_at < now() - make_interval(mins => $1))`,
    [STALE_FETCHING_MINUTES],
  )
  return res.rowCount ?? 0
}

/**
 * Source tiles covering a web-mercator tile that have never been fetched, or were reset by
 * resetStaleFetching.
 *
 * Deliberately excludes 'failed': a tile that already errored should not be retried
 * on every pan across it. Re-running the CLI with --force is the way back.
 */
export async function findUnfetchedTiles(
  pool: pg.Pool,
  z: number,
  x: number,
  y: number,
): Promise<Map<string, TileRef[]>> {
  const { rows } = await pool.query(
    `SELECT ti.state, ti.tile_id, ti.url, ti.size_bytes, ti.sha256, ti.source_ts,
            ST_XMin(ti.bbox) minx, ST_YMin(ti.bbox) miny,
            ST_XMax(ti.bbox) maxx, ST_YMax(ti.bbox) maxy
       FROM tile_index ti
       LEFT JOIN tile_status ts ON ts.state = ti.state AND ts.tile_id = ti.tile_id
      WHERE ST_Intersects(ti.bbox, ST_Transform(ST_TileEnvelope($1,$2,$3), 4326))
        AND (ts.status IS NULL OR ts.status = 'unfetched')
      ORDER BY ti.size_bytes ASC
      LIMIT 32`,
    [z, x, y],
  )

  const byState = new Map<string, TileRef[]>()
  for (const r of rows) {
    const arr = byState.get(r.state) ?? []
    arr.push({
      id: r.tile_id,
      url: r.url,
      sizeBytes: Number(r.size_bytes),
      sha256: r.sha256,
      bbox: { minX: r.minx, minY: r.miny, maxX: r.maxx, maxY: r.maxy },
      sourceTs: r.source_ts ? new Date(r.source_ts).toISOString() : null,
    })
    byState.set(r.state, arr)
  }
  return byState
}
