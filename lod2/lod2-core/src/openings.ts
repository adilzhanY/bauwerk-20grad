/**
 * Openings (windows and doors) drawn on a rectified wall image, kept in wall metres.
 *
 * The wall's coordinate frame is the one `wallToPlane` defines: u along the wall, v up,
 * (0, 0) at the bottom left. The wall image is an ordinary picture with y going down, so
 * converting between the two flips y.
 */
import type { Point2 } from './photo.ts'

/** A rectangle in wall metres. (x, y) is its bottom-left corner. */
export interface Opening {
  x: number
  y: number
  width: number
  height: number
  /** Detector confidence, 0 to 1, when the opening was proposed by lod2-vision. */
  score?: number
  /** Window or door. Missing means a window, the common case when drawn by hand. */
  kind?: 'window' | 'door'
}

/** A wall-image pixel to wall metres. */
export function imageToWall(point: Point2, imageHeight: number, pixelsPerMetre: number): Point2 {
  return {
    x: point.x / pixelsPerMetre,
    y: (imageHeight - point.y) / pixelsPerMetre,
  }
}

/** Wall metres to a wall-image pixel. */
export function wallToImage(point: Point2, imageHeight: number, pixelsPerMetre: number): Point2 {
  return {
    x: point.x * pixelsPerMetre,
    y: imageHeight - point.y * pixelsPerMetre,
  }
}

/** The rectangle between two drag corners, in wall metres, whatever direction was dragged. */
export function openingFromDrag(start: Point2, end: Point2): Opening {
  const x = Math.min(start.x, end.x)
  const y = Math.min(start.y, end.y)
  return {
    x,
    y,
    width: Math.abs(end.x - start.x),
    height: Math.abs(end.y - start.y),
  }
}

export function openingArea(opening: Opening): number {
  return opening.width * opening.height
}

export function totalOpeningArea(openings: readonly Opening[]): number {
  let sum = 0
  for (const o of openings) sum += openingArea(o)
  return sum
}

/** Opening area over wall area. Null for a wall with no area. */
export function windowToWallRatio(
  openings: readonly Opening[],
  wallWidth: number,
  wallHeight: number,
): number | null {
  const wallArea = wallWidth * wallHeight
  if (wallArea <= 0) return null
  return totalOpeningArea(openings) / wallArea
}

/** True when the point (wall metres) lies inside the opening, edges included. */
export function openingContains(opening: Opening, point: Point2): boolean {
  return (
    point.x >= opening.x &&
    point.x <= opening.x + opening.width &&
    point.y >= opening.y &&
    point.y <= opening.y + opening.height
  )
}

/** Size of an opening created from the toolbar rather than drawn: a common window. */
export const DEFAULT_OPENING_WIDTH_M = 1.2
export const DEFAULT_OPENING_HEIGHT_M = 1.5

export function moveOpening(opening: Opening, dx: number, dy: number): Opening {
  return { ...opening, x: opening.x + dx, y: opening.y + dy }
}

export function resizeOpening(opening: Opening, width: number, height: number): Opening {
  return { ...opening, width, height }
}

/**
 * Keep an opening inside the wall: shrink it to the wall if it is larger, then slide it
 * so no edge sticks out.
 */
export function clampOpening(opening: Opening, wallWidth: number, wallHeight: number): Opening {
  const width = Math.min(Math.max(opening.width, 0), wallWidth)
  const height = Math.min(Math.max(opening.height, 0), wallHeight)
  const x = Math.min(Math.max(opening.x, 0), wallWidth - width)
  const y = Math.min(Math.max(opening.y, 0), wallHeight - height)
  // Keep the detector's confidence and the kind: clamping moves the box, nothing else.
  const clamped: Opening = { x, y, width, height }
  if (opening.score !== undefined) clamped.score = opening.score
  if (opening.kind !== undefined) clamped.kind = opening.kind
  return clamped
}

/** A default-sized opening in the middle of the wall. */
export function defaultOpening(wallWidth: number, wallHeight: number): Opening {
  const opening = {
    x: (wallWidth - DEFAULT_OPENING_WIDTH_M) / 2,
    y: (wallHeight - DEFAULT_OPENING_HEIGHT_M) / 2,
    width: DEFAULT_OPENING_WIDTH_M,
    height: DEFAULT_OPENING_HEIGHT_M,
  }
  return clampOpening(opening, wallWidth, wallHeight)
}

/**
 * A copy of the opening placed `gap` metres to its right. If that would leave the wall,
 * the copy starts a new row at the left edge, below the original, or above it when there is
 * no room below. Null when the wall has no free row for it, rather than a copy on top of
 * the original.
 */
export function duplicateOpening(
  opening: Opening,
  gap: number,
  wallWidth: number,
  wallHeight: number,
): Opening | null {
  const copy = { x: opening.x, y: opening.y, width: opening.width, height: opening.height }
  if (copy.width > wallWidth || copy.height > wallHeight) return null
  const right = moveOpening(copy, copy.width + gap, 0)
  if (right.x + right.width <= wallWidth) return right
  const below = { ...copy, x: 0, y: copy.y - copy.height - gap }
  if (below.y >= 0) return below
  const above = { ...copy, x: 0, y: copy.y + copy.height + gap }
  if (above.y + above.height <= wallHeight) return above
  return null
}

/** The per-wall numbers an energy assessment wants, computed in one place. */
export interface OpeningsSummary {
  count: number
  /** Sum of opening areas, m². */
  openingArea: number
  /** Wall area from the model, m². */
  wallArea: number
  /** openingArea / wallArea, or null when the wall has no area. */
  ratio: number | null
}

export function openingsSummary(openings: readonly Opening[], wallArea: number): OpeningsSummary {
  const openingAreaTotal = totalOpeningArea(openings)
  return {
    count: openings.length,
    openingArea: openingAreaTotal,
    wallArea,
    ratio: wallArea > 0 ? openingAreaTotal / wallArea : null,
  }
}

/** Which edges a resize grab controls. Each side is -1 (left or bottom), 1 (right or top) or 0. */
export interface ResizeHandle {
  x: -1 | 0 | 1
  y: -1 | 0 | 1
}

/** The side of a span a value sits in: -1 in the first third, 1 in the last third, else 0. */
function thirdOf(value: number, start: number, size: number): -1 | 0 | 1 {
  if (size <= 0) return 0
  const t = (value - start) / size
  if (t < 1 / 3) return -1
  if (t > 2 / 3) return 1
  return 0
}

/** The side of a span's middle a value is on, for the centre zone. */
function nearerSide(value: number, start: number, size: number): -1 | 1 {
  return value - start < size / 2 ? -1 : 1
}

/**
 * Which edges a grab point on the opening controls. The opening is split into a three by three
 * grid: a corner zone moves two edges, an edge zone moves one, and the centre zone moves the
 * corner nearest to the point so that every grab does something.
 */
export function resizeHandleAt(opening: Opening, point: Point2): ResizeHandle {
  const x = thirdOf(point.x, opening.x, opening.width)
  const y = thirdOf(point.y, opening.y, opening.height)
  if (x === 0 && y === 0) {
    return {
      x: nearerSide(point.x, opening.x, opening.width),
      y: nearerSide(point.y, opening.y, opening.height),
    }
  }
  return { x, y }
}

/**
 * The new [start, end] of one axis after moving the chosen edge by `delta`. The opposite
 * edge never moves: when the span would get shorter than `minSize`, the moving edge stops
 * `minSize` away from it, on whichever side it was dragged to.
 */
function resizeAxis(
  start: number,
  size: number,
  side: -1 | 0 | 1,
  delta: number,
  minSize: number,
): [number, number] {
  if (side === 0) return [start, start + size]
  const fixed = side === 1 ? start : start + size
  let moving = (side === 1 ? start + size : start) + delta
  if (Math.abs(moving - fixed) < minSize) {
    const direction = moving === fixed ? side : Math.sign(moving - fixed)
    moving = fixed + direction * minSize
  }
  return moving >= fixed ? [fixed, moving] : [moving, fixed]
}

/**
 * The opening after dragging the edges in `handle` by (dx, dy) metres. The other edges stay
 * put. Dragging an edge past the opposite one flips the opening rather than giving it a
 * negative size, and neither side gets smaller than `minSize`.
 */
export function resizeOpeningByHandle(
  opening: Opening,
  handle: ResizeHandle,
  dx: number,
  dy: number,
  minSize: number,
): Opening {
  const [left, right] = resizeAxis(opening.x, opening.width, handle.x, dx, minSize)
  const [bottom, top] = resizeAxis(opening.y, opening.height, handle.y, dy, minSize)
  return { x: left, y: bottom, width: right - left, height: top - bottom }
}

/** A copy of the opening with its centre on `point`, kept inside the wall. */
export function openingCenteredAt(
  opening: Opening,
  point: Point2,
  wallWidth: number,
  wallHeight: number,
): Opening {
  const moved = {
    ...opening,
    x: point.x - opening.width / 2,
    y: point.y - opening.height / 2,
  }
  return clampOpening(moved, wallWidth, wallHeight)
}
