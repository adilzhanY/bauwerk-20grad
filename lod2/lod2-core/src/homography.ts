/**
 * Plane-to-plane projective mapping (a homography) from four point pairs.
 *
 * A flat wall seen by a camera is related to its photograph by exactly this kind of map,
 * so four matched corners are enough to send any wall point to the photo and back.
 */
import type { Point2, Quad } from './photo.ts'

/** 3x3 matrix, row by row. The last entry is fixed at 1. */
export type Homography = [number, number, number, number, number, number, number, number, number]

/** Below this, a pivot counts as zero and the four points do not define a mapping. */
const PIVOT_EPS = 1e-12
/** A corner this flat, relative to the quad's size, counts as three points on one line. */
const FLAT_CORNER_EPS = 1e-6

/**
 * The homography that sends each `from[i]` to `to[i]`. Both lists must be in the same
 * order, for example top-left, top-right, bottom-right, bottom-left.
 *
 * Null when the points do not pin down a mapping, such as three of them on one line, or
 * when either quad is not convex: a crossed or dented quad solves to a folded mapping that
 * smears the photo instead of straightening it.
 */
export function homographyFromPairs(from: Quad, to: Quad): Homography | null {
  if (!isConvexQuad(from) || !isConvexQuad(to)) return null
  const rows: number[][] = []
  for (let i = 0; i < 4; i++) {
    const { x: u, y: v } = from[i]!
    const { x, y } = to[i]!
    // x = (a u + b v + c) / (g u + h v + 1), multiplied out into a linear row.
    rows.push([u, v, 1, 0, 0, 0, -u * x, -v * x, x])
    rows.push([0, 0, 0, u, v, 1, -u * y, -v * y, y])
  }
  const solution = solveLinearSystem(rows)
  if (!solution) return null
  const [a, b, c, d, e, f, g, h] = solution
  return [a!, b!, c!, d!, e!, f!, g!, h!, 1]
}

/**
 * True when the four corners, in order, turn the same way at every corner and no corner is
 * flat. That rules out three points on a line, a crossed "bow tie", and a dented quad.
 */
export function isConvexQuad(quad: Quad): boolean {
  const xs = quad.map((p) => p.x)
  const ys = quad.map((p) => p.y)
  const span = Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys))
  if (!(span > 0)) return false
  const minTurn = FLAT_CORNER_EPS * span * span
  let sign = 0
  for (let i = 0; i < 4; i++) {
    const turn = cornerTurn(quad[(i + 3) % 4]!, quad[i]!, quad[(i + 1) % 4]!)
    if (Math.abs(turn) < minTurn) return false
    const turnSign = Math.sign(turn)
    if (sign !== 0 && turnSign !== sign) return false
    sign = turnSign
  }
  return true
}

/** Cross product of the two edges meeting at `b`: its sign says which way the path turns. */
function cornerTurn(a: Point2, b: Point2, c: Point2): number {
  return (b.x - a.x) * (c.y - b.y) - (b.y - a.y) * (c.x - b.x)
}

export function applyHomography(H: Homography, point: Point2): Point2 {
  const { x, y } = point
  const w = H[6] * x + H[7] * y + H[8]
  return {
    x: (H[0] * x + H[1] * y + H[2]) / w,
    y: (H[3] * x + H[4] * y + H[5]) / w,
  }
}

/** The mapping in the other direction. Null when the matrix has no inverse. */
export function invertHomography(H: Homography): Homography | null {
  const [a, b, c, d, e, f, g, h, i] = H
  const cofactorA = e * i - f * h
  const cofactorB = -(d * i - f * g)
  const cofactorC = d * h - e * g
  const det = a * cofactorA + b * cofactorB + c * cofactorC
  if (Math.abs(det) < PIVOT_EPS) return null

  const inverse: number[] = [
    cofactorA, -(b * i - c * h), b * f - c * e,
    cofactorB, a * i - c * g, -(a * f - c * d),
    cofactorC, -(a * h - b * g), a * e - b * d,
  ]
  // Scale so the last entry is 1 again; a homography is only defined up to scale.
  const last = inverse[8]!
  if (Math.abs(last) < PIVOT_EPS) return null
  return inverse.map((value) => value / last) as Homography
}

/**
 * Gaussian elimination with row swapping. Each row is the coefficients followed by the
 * right-hand side. Returns the unknowns, or null when a pivot is zero.
 */
function solveLinearSystem(rows: number[][]): number[] | null {
  const n = rows.length
  for (let col = 0; col < n; col++) {
    const pivotRow = findPivotRow(rows, col)
    if (pivotRow === null) return null
    swapRows(rows, col, pivotRow)
    eliminateBelow(rows, col)
  }
  return backSubstitute(rows)
}

function findPivotRow(rows: number[][], col: number): number | null {
  let best: number | null = null
  let bestSize = PIVOT_EPS
  for (let r = col; r < rows.length; r++) {
    const size = Math.abs(rows[r]![col]!)
    if (size > bestSize) {
      bestSize = size
      best = r
    }
  }
  return best
}

function swapRows(rows: number[][], a: number, b: number): void {
  if (a === b) return
  const tmp = rows[a]!
  rows[a] = rows[b]!
  rows[b] = tmp
}

function eliminateBelow(rows: number[][], col: number): void {
  const pivot = rows[col]!
  for (let r = col + 1; r < rows.length; r++) {
    const row = rows[r]!
    const factor = row[col]! / pivot[col]!
    if (factor === 0) continue
    for (let k = col; k < pivot.length; k++) {
      row[k] = row[k]! - factor * pivot[k]!
    }
  }
}



function backSubstitute(rows: number[][]): number[] {
  const n = rows.length
  const result: number[] = Array.from({ length: n }, () => 0)
  for (let r = n - 1; r >= 0; r--) {
    const row = rows[r]!
    let sum = row[n]!
    for (let k = r + 1; k < n; k++) sum -= row[k]! * result[k]!
    result[r] = sum / row[r]!
  }
  return result
}


