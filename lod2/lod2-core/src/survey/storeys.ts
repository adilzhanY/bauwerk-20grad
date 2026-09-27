/**
 * Storeys from the only height data LoD2 has: the eave height of a part.
 *
 * Berlin's LoD2 carries no storey count, so it is estimated from the height above the street
 * and handed to the user to confirm.
 */

/** Typical floor-to-floor height of buildings before 1949 (high ceilings) and after. */
export const OLD_STOREY_M = 3.1
export const NEW_STOREY_M = 2.8

/**
 * How many storeys fit under the eave. `typical` is the floor-to-floor height of the age
 * class. At least one.
 */
export function estimateStoreys(eaveAboveStreet: number, typical: number): number {
  if (!(eaveAboveStreet > 0) || !(typical > 0)) return 1
  return Math.max(1, Math.round(eaveAboveStreet / typical))
}

/** `count` equal storey heights that together reach the eave, rounded to the centimetre. */
export function storeyHeights(eaveAboveStreet: number, count: number): number[] {
  const safeCount = Math.max(1, Math.round(count))
  const height = Math.round((eaveAboveStreet / safeCount) * 100) / 100
  return Array.from({ length: safeCount }, () => height)
}

/**
 * The storey an opening sits in: the one holding its bottom edge, nudged up when the opening
 * reaches mostly into the next storey. Heights are measured from the street.
 */
export function storeyOf(bottom: number, top: number, heights: readonly number[]): number {
  let floor = 0
  for (let i = 0; i < heights.length; i++) {
    const ceiling = floor + heights[i]!
    if (bottom < ceiling - 1e-9) {
      const inside = Math.min(top, ceiling) - Math.max(bottom, floor)
      const above = top - ceiling
      return above > inside && i + 1 < heights.length ? i + 1 : i
    }
    floor = ceiling
  }
  return heights.length - 1
}

/** Height of the floor of storey `index` above the street. */
export function floorLevel(index: number, heights: readonly number[]): number {
  let level = 0
  for (let i = 0; i < index; i++) level += heights[i]!
  return level
}

/** An opening's vertical extent above the street, metres. */
export interface VerticalSpan {
  bottom: number
  top: number
}

/** A storey needs at least this much height; rows closer together are one storey. */
const MIN_STOREY_M = 2.2
/** Openings that end this low and are this short are basement windows or grilles. */
const BASEMENT_TOP_M = 1.5
const BASEMENT_HEIGHT_M = 1.0

/**
 * Storey heights read off the rows of openings on a photographed facade: openings whose
 * heights overlap form one row, each row is one storey, and the floor between two rows lies
 * halfway between the top of the lower row and the bottom of the upper one. The ground floor
 * starts at the street and the top storey ends at the eave.
 *
 * Null when the photo shows fewer than two rows, which says nothing about the storeys.
 */
export function storeysFromOpenings(spans: readonly VerticalSpan[], eaveAboveStreet: number): number[] | null {
  const usable = spans.filter((s) => !(s.top <= BASEMENT_TOP_M && s.top - s.bottom < BASEMENT_HEIGHT_M))
  const rows = rowsOf(usable).filter((row) => row.bottom < eaveAboveStreet)
  if (rows.length < 2) return null
  const floors = [0]
  for (let i = 1; i < rows.length; i++) {
    const floor = (rows[i - 1]!.top + rows[i]!.bottom) / 2
    // Two rows closer than a storey are one storey, for example a transom over a shop door.
    if (floor - floors[floors.length - 1]! >= MIN_STOREY_M) floors.push(floor)
  }
  if (eaveAboveStreet - floors[floors.length - 1]! < MIN_STOREY_M) floors.pop()
  if (floors.length < 2) return null
  return floors.map((floor, i) => {
    const next = floors[i + 1] ?? eaveAboveStreet
    return Math.round((next - floor) * 100) / 100
  })
}

/** Group spans into rows: each row is a run of spans whose heights overlap. */
export function rowsOf(spans: readonly VerticalSpan[]): VerticalSpan[] {
  const sorted = [...spans].sort((a, b) => a.bottom - b.bottom)
  const rows: VerticalSpan[] = []
  for (const span of sorted) {
    const last = rows[rows.length - 1]
    // Overlapping by more than a hand's width joins the row.
    if (last && span.bottom < last.top - 0.1) {
      last.top = Math.max(last.top, span.top)
    } else {
      rows.push({ bottom: span.bottom, top: span.top })
    }
  }
  return rows
}
