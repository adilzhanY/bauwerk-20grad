/**
 * Windows for a facade nobody has photographed, after the official survey rule for existing
 * homes (Bekanntmachung der Regeln zur Datenaufnahme im Wohngebäudebestand, 8 October 2020,
 * table 1, line 1a): the window width is 55 percent of the room width, and the window height
 * is the clear room height minus 1.50 m. Rooms run along the whole facade, so the windows of
 * a storey take 55 percent of the wall's length, split into windows about 1.2 m wide.
 */

export interface CatalogueWindow {
  offset: number
  width: number
  height: number
  sill: number
}

/** Share of the wall length that is window, table 1 line 1a. */
export const WINDOW_WIDTH_SHARE = 0.55
/** Clear room height minus this is the window height, table 1 line 1a. */
export const WINDOW_HEIGHT_DEDUCTION_M = 1.5
/** The floor slab between clear room height and storey height. */
const SLAB_M = 0.3
/** Typical window width the share is split into. */
const WINDOW_WIDTH_M = 1.2
/** Sill height above the floor. */
const SILL_M = 0.9
/** Walls shorter than this get no window. */
const MIN_WALL_M = 1.5
const MIN_WINDOW_HEIGHT_M = 0.6

/** The windows of one storey on one wall, evenly spaced. Empty for a short or low wall. */
export function catalogueWindows(wallLength: number, storeyHeight: number): CatalogueWindow[] {
  if (!(wallLength >= MIN_WALL_M)) return []
  const clearHeight = storeyHeight - SLAB_M
  const height = Math.min(clearHeight - WINDOW_HEIGHT_DEDUCTION_M, storeyHeight - SILL_M - 0.1)
  if (!(height >= MIN_WINDOW_HEIGHT_M)) return []
  const total = wallLength * WINDOW_WIDTH_SHARE
  const count = Math.max(1, Math.round(total / WINDOW_WIDTH_M))
  const width = total / count
  const slot = wallLength / count
  return Array.from({ length: count }, (_, i) => ({
    offset: round(i * slot + (slot - width) / 2),
    width: Math.floor(width * 1000) / 1000,
    height: Math.floor(height * 1000) / 1000,
    sill: SILL_M,
  }))
}

function round(v: number): number {
  return Math.round(v * 1000) / 1000
}
