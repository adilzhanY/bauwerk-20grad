/**
 * Spaces out requests to each upstream host.
 *
 * Every outgoing request to a public authority server (orthophoto crops, aerial map tiles and
 * on-demand tile downloads) goes through the one shared pacer, so the combined rate per host
 * stays bounded no matter which route triggered it.
 *
 * The next free slot is reserved synchronously, before any await. Reading the last request
 * time, sleeping, then writing it would let concurrent callers all read the same value and
 * fire together.
 */
export class HostPacer {
  readonly #intervalMs: number
  readonly #now: () => number
  readonly #nextSlot = new Map<string, number>()

  constructor(intervalMs: number, now: () => number = Date.now) {
    this.#intervalMs = intervalMs
    this.#now = now
  }

  /**
   * Reserve the next free slot for the url's host and return how many milliseconds to wait
   * for it. Returns null, reserving nothing, when the wait would exceed maxWaitMs.
   */
  reserve(url: string, maxWaitMs = Number.POSITIVE_INFINITY): number | null {
    const host = new URL(url).host
    const now = this.#now()
    const slot = Math.max(now, this.#nextSlot.get(host) ?? 0)
    const wait = slot - now
    if (wait > maxWaitMs) return null
    this.#nextSlot.set(host, slot + this.#intervalMs)
    return wait
  }

  /** Wait for a slot. Resolves false, without waiting, when the queue is longer than maxWaitMs. */
  async wait(url: string, maxWaitMs?: number): Promise<boolean> {
    const wait = this.reserve(url, maxWaitMs)
    if (wait === null) return false
    if (wait > 0) await sleep(wait)
    return true
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/** Minimum gap between two requests to the same upstream host. */
export const MIN_HOST_INTERVAL_MS = 250

/** The one pacer shared by every route that talks to an upstream host. */
export const upstreamPacer = new HostPacer(MIN_HOST_INTERVAL_MS)
