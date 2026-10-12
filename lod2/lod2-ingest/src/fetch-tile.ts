import { createWriteStream } from 'node:fs'
import { mkdir, rename, stat } from 'node:fs/promises'
import { dirname } from 'node:path'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { setImmediate } from 'node:timers/promises'
import { createReadStream } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { readArchiveMember } from './unzip.ts'

/**
 * Decode a byte stream to text without splitting multi-byte characters.
 *
 * This matters: German address and place names are full of umlauts, and a naive
 * per-chunk `toString('utf8')` corrupts any character straddling a chunk boundary.
 */
export async function* decodeUtf8(
  source: AsyncIterable<Uint8Array> | ReadableStream<Uint8Array>,
): AsyncGenerator<string> {
  const decoder = new TextDecoder('utf-8')
  const iterable: AsyncIterable<Uint8Array> =
    Symbol.asyncIterator in Object(source)
      ? (source as AsyncIterable<Uint8Array>)
      : (Readable.fromWeb(source as ReadableStream<Uint8Array>) as unknown as AsyncIterable<Uint8Array>)
  for await (const chunk of iterable) {
    yield decoder.decode(chunk, { stream: true })
  }
  const tail = decoder.decode()
  if (tail) yield tail
}

export interface FetchOptions {
  /** Save the raw GML here and reuse it on the next run. Off by default: a whole-state
   *  ingest would leave tens of gigabytes of cache behind for no benefit. */
  cachePath?: string
  expectedBytes?: number
  retries?: number
  signal?: AbortSignal
  /**
   * When the tile is a ZIP, which member holds the CityGML.
   *
   * An archive has to be whole before anything can be read out of it (the directory is at
   * the end), so this path buffers the download instead of streaming it. A Berlin tile is a
   * few megabytes compressed, which is the scale this is meant for.
   */
  archiveMember?: RegExp
}

/**
 * One buffer as the same async text iterable a streamed body produces, in slices.
 *
 * Handing the parser a whole unzipped tile parses it in one synchronous call; a turn of the
 * event loop between slices keeps the API answering while an on-demand tile loads.
 */
export async function* textOf(data: Uint8Array, sliceBytes = 1 << 20): AsyncGenerator<string> {
  async function* slices(): AsyncGenerator<Uint8Array> {
    for (let i = 0; i < data.length; i += sliceBytes) {
      if (i > 0) await setImmediate()
      yield data.subarray(i, i + sliceBytes)
    }
  }
  yield* decodeUtf8(slices())
}

async function existsWithSize(path: string, expected?: number): Promise<boolean> {
  try {
    const s = await stat(path)
    return s.size > 0 && (expected === undefined || s.size === expected)
  } catch {
    return false
  }
}

/** An HTTP answer that asking again will not change, such as 404 or 403. */
class PermanentHttpError extends Error {
  override name = 'PermanentHttpError'
}

/**
 * Whether an HTTP error status is worth another try.
 *
 * Server errors (5xx), a request timeout (408) and rate limiting (429) can pass. Any other
 * 4xx means the request itself is wrong and will fail the same way every time.
 */
export function isRetryableStatus(status: number): boolean {
  return status >= 500 || status === 408 || status === 429
}

/**
 * Stream one source tile as text, optionally through a disk cache.
 *
 * Retries with backoff on transient failures. These are public authority servers;
 * a tight retry loop against one is how you get an IP block.
 */
export async function fetchTileText(url: string, opts: FetchOptions = {}): Promise<AsyncIterable<string>> {
  const { cachePath, expectedBytes, retries = 3, archiveMember } = opts

  if (cachePath && (await existsWithSize(cachePath, expectedBytes))) {
    return archiveMember
      ? textOf(readArchiveMember(await readFile(cachePath), archiveMember).data)
      : decodeUtf8(createReadStream(cachePath) as unknown as AsyncIterable<Uint8Array>)
  }

  let lastError: Error | null = null
  for (let attempt = 0; attempt <= retries; attempt++) {
    if (attempt > 0) {
      const backoffMs = Math.min(30_000, 1000 * 2 ** attempt)
      await new Promise((r) => setTimeout(r, backoffMs))
    }
    try {
      const res = await fetch(url, { signal: opts.signal })
      if (!res.ok) {
        if (!isRetryableStatus(res.status)) {
          throw new PermanentHttpError(`${url} returned ${res.status} ${res.statusText}`)
        }
        lastError = new Error(`${url} returned ${res.status}`)
        continue
      }
      if (!res.body) throw new Error(`${url} returned an empty body`)

      if (cachePath) {
        await mkdir(dirname(cachePath), { recursive: true })
        const tmp = `${cachePath}.part`
        await pipeline(Readable.fromWeb(res.body as never), createWriteStream(tmp))
        await rename(tmp, cachePath)
        return archiveMember
          ? textOf(readArchiveMember(await readFile(cachePath), archiveMember).data)
          : decodeUtf8(createReadStream(cachePath) as unknown as AsyncIterable<Uint8Array>)
      }
      if (archiveMember) {
        return textOf(readArchiveMember(Buffer.from(await res.arrayBuffer()), archiveMember).data)
      }
      return decodeUtf8(res.body as ReadableStream<Uint8Array>)
    } catch (err) {
      if ((err as Error).name === 'AbortError') throw err
      if (err instanceof PermanentHttpError) throw err
      lastError = err as Error
      if (attempt === retries) break
    }
  }
  throw lastError ?? new Error(`Failed to fetch ${url}`)
}
