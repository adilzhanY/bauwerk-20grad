/**
 * Small, pure helpers for reading and validating request input.
 */

/**
 * A query parameter as one string, or undefined.
 *
 * A repeated parameter (?q=a&q=b) arrives as an array. It is treated as absent rather than
 * guessed at, so no route ever calls a string method on an array.
 */
export function singleParam(value: unknown): string | undefined {
  if (typeof value === 'string') return value
  return undefined
}

const GID_PATTERN = /^[A-Za-z0-9_.-]{1,64}$/

/** AdV building ids are short ASCII strings; anything else never reaches the database. */
export function isValidGid(value: string): boolean {
  return GID_PATTERN.test(value)
}

/** Escape a user string for use inside a LIKE pattern written with ESCAPE '\'. */
export function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (ch) => `\\${ch}`)
}

export const NEIGHBOUR_BOX_DEFAULT_M = 800
export const NEIGHBOUR_BOX_MIN_M = 20
export const NEIGHBOUR_BOX_MAX_M = 1200

/** Neighbour box size in metres, the default when absent, or null when invalid. */
export function parseNeighbourBox(raw: string | undefined): number | null {
  if (raw === undefined) return NEIGHBOUR_BOX_DEFAULT_M
  if (raw.trim() === '') return null
  const box = Number(raw)
  if (!Number.isFinite(box)) return null
  if (box < NEIGHBOUR_BOX_MIN_M || box > NEIGHBOUR_BOX_MAX_M) return null
  return box
}

export const DEFAULT_CORS_ORIGINS = ['http://localhost:5173', 'http://127.0.0.1:5173']

/** Comma separated origins from the environment, or the local app's defaults. */
export function parseCorsOrigins(raw: string | undefined): string[] {
  if (raw === undefined) return DEFAULT_CORS_ORIGINS
  const origins = raw.split(',').map((o) => o.trim()).filter((o) => o.length > 0)
  if (origins.length === 0) return DEFAULT_CORS_ORIGINS
  return origins
}

/** True for a finite longitude and latitude in their ranges. */
export function isLonLat(lon: number, lat: number): boolean {
  return Number.isFinite(lon) && Number.isFinite(lat) && Math.abs(lon) <= 180 && Math.abs(lat) <= 90
}
