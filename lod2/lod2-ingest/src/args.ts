/**
 * Command line parsing and validation for the ingest CLI.
 *
 * Kept apart from `cli.ts` so the checks can be tested without a database. Every
 * validator throws an Error with a message meant for the operator; `cli.ts` prints it
 * and exits with code 1.
 */

export interface Args {
  _: string[]
  [k: string]: string | boolean | string[]
}

export interface Bbox {
  minX: number
  minY: number
  maxX: number
  maxY: number
}

export interface LonLat {
  lon: number
  lat: number
}

export function parseArgs(argv: string[]): Args {
  const args: Args = { _: [] }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!
    if (!a.startsWith('--')) {
      args._.push(a)
      continue
    }
    const [key, inline] = a.slice(2).split('=', 2)
    const next = argv[i + 1]
    if (inline !== undefined) {
      args[key!] = inline
    } else if (next && !next.startsWith('--')) {
      args[key!] = next
      i++
    } else {
      args[key!] = true
    }
  }
  return args
}

/** The string value of an option, or undefined when absent or given as a bare flag. */
export function str(args: Args, key: string): string | undefined {
  const value = args[key]
  return typeof value === 'string' ? value : undefined
}

/**
 * The value of an option that needs one, such as `--limit 10`.
 *
 * Undefined when the option is absent. A bare `--limit` with nothing after it is an error
 * rather than a silent fallback to the default.
 */
export function valueOf(args: Args, key: string): string | undefined {
  const value = args[key]
  if (value === undefined) return undefined
  if (typeof value !== 'string') throw new Error(`--${key} needs a value`)
  return value
}

/** Split "a,b,c" into numbers, requiring exactly `count` finite values. */
export function parseNumberList(value: string, count: number, flag: string): number[] {
  const parts = value.split(',')
  const numbers = parts.map((p) => (p.trim() === '' ? Number.NaN : Number(p)))
  if (numbers.length !== count || numbers.some((n) => !Number.isFinite(n))) {
    throw new Error(`${flag} needs exactly ${count} comma separated numbers, got "${value}"`)
  }
  return numbers
}

/** minx,miny,maxx,maxy with each minimum strictly below its maximum. */
export function parseBbox(value: string, flag: string): Bbox {
  const [minX, minY, maxX, maxY] = parseNumberList(value, 4, flag) as [number, number, number, number]
  if (minX >= maxX || minY >= maxY) {
    throw new Error(`${flag} must be minx,miny,maxx,maxy with min < max, got "${value}"`)
  }
  return { minX, minY, maxX, maxY }
}

export function parseLonLat(value: string, flag: string): LonLat {
  const [lon, lat] = parseNumberList(value, 2, flag) as [number, number]
  return { lon, lat }
}

/** A whole number of at least 1, such as a worker count or a row limit. */
export function parsePositiveInt(value: string | undefined, fallback: number, flag: string): number {
  if (value === undefined) return fallback
  const n = Number(value)
  if (value.trim() === '' || !Number.isInteger(n) || n < 1) {
    throw new Error(`${flag} must be a positive whole number, got "${value}"`)
  }
  return n
}

/** A finite number above zero, such as a radius. */
export function parsePositiveNumber(value: string | undefined, fallback: number, flag: string): number {
  if (value === undefined) return fallback
  const n = Number(value)
  if (value.trim() === '' || !Number.isFinite(n) || n <= 0) {
    throw new Error(`${flag} must be a number above zero, got "${value}"`)
  }
  return n
}
