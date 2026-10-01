/**
 * Windows and doors measured on one LoD2 wall (in wall metres, origin bottom left, seen from
 * outside) placed onto an editor footprint: which footprint edge, how far along it, which
 * storey, and how high above that storey's floor.
 *
 * The editor stores an opening per storey and per footprint edge, with an offset from the
 * edge's start. For a counter-clockwise footprint an edge runs left to right as seen from
 * outside, the same direction as the wall's u axis, so offsets grow the same way.
 */
import { planeToWorld, type WallPlane } from '../wall.ts'
import { distance, toPlan, type PlanFrame, type Vec2 } from './footprint.ts'
import { germanText, message, type SurveyMessage } from './messages.ts'
import { floorLevel, storeyOf } from './storeys.ts'

export interface MeasuredOpening {
  kind: 'window' | 'door'
  /** Wall metres from the left of the wall plane. */
  x: number
  /** Wall metres from the bottom of the wall plane. */
  y: number
  width: number
  height: number
  score?: number
}

export interface PlacedOpening {
  kind: 'window' | 'door'
  edge: number
  storey: number
  offset: number
  width: number
  height: number
  sill: number
  score?: number
  /** Index of the measured opening this came from. */
  source: number
  /** Why the opening differs from what was measured, when it does, in German. */
  notes: string[]
  /** The same notes as message keys. */
  messages: SurveyMessage[]
}

export interface PlacementResult {
  placed: PlacedOpening[]
  /** Openings that could not be placed, with the reason. */
  dropped: { opening: MeasuredOpening; reason: string }[]
  /** The footprint edge the wall matched, or null. */
  edge: number | null
}

/** An edge counts as the wall's edge when it is this parallel and this close. */
const EDGE_ANGLE_DEG = 8
const EDGE_DISTANCE_M = 0.6
/** A door whose bottom is this close to the storey floor reaches down to it: measuring slop. */
const DOOR_FLOOR_M = 0.3
/**
 * A door up to this far above the floor still stands on it, at the height measured. The
 * model's ground floor starts at the street, and the steps up to an old building's entrance
 * lift a real door by up to a metre above that (BOo: 0.34 m). Higher, it is a window that
 * reaches low.
 */
const DOOR_STEPS_M = 1.0
/** Openings smaller than this on either side are dropped. */
const MIN_OPENING_M = 0.2
/** Bauwerk's own lower limit for an opening side. */
const EDITOR_MIN_M = 0.1

interface Edge {
  a: Vec2
  b: Vec2
  length: number
  /** Unit direction a to b. */
  dir: Vec2
}

export function footprintEdges(footprint: readonly Vec2[]): Edge[] {
  return footprint.map((a, i) => {
    const b = footprint[(i + 1) % footprint.length]!
    const length = distance(a, b)
    return { a, b, length, dir: { x: (b.x - a.x) / length, y: (b.y - a.y) / length } }
  })
}

/** Distance along the edge from its start, for a point in plan. */
function along(edge: Edge, p: Vec2): number {
  return (p.x - edge.a.x) * edge.dir.x + (p.y - edge.a.y) * edge.dir.y
}

/** Distance of a point from the edge's line. */
function across(edge: Edge, p: Vec2): number {
  return Math.abs((p.x - edge.a.x) * edge.dir.y - (p.y - edge.a.y) * edge.dir.x)
}

/**
 * The footprint edge a wall stands on: same direction within `EDGE_ANGLE_DEG`, both wall
 * ends within `EDGE_DISTANCE_M` of its line, and the most overlap with it. Null when none.
 */
export function matchEdge(start: Vec2, end: Vec2, footprint: readonly Vec2[]): number | null {
  const wallLength = distance(start, end)
  if (wallLength < 1e-6) return null
  const wallDir = { x: (end.x - start.x) / wallLength, y: (end.y - start.y) / wallLength }
  let best: number | null = null
  let bestOverlap = 0
  footprintEdges(footprint).forEach((edge, index) => {
    const cos = wallDir.x * edge.dir.x + wallDir.y * edge.dir.y
    if (cos < Math.cos((EDGE_ANGLE_DEG * Math.PI) / 180)) return
    if (across(edge, start) > EDGE_DISTANCE_M || across(edge, end) > EDGE_DISTANCE_M) return
    const from = Math.max(0, along(edge, start))
    const to = Math.min(edge.length, along(edge, end))
    const overlap = to - from
    if (overlap > bestOverlap) {
      bestOverlap = overlap
      best = index
    }
  })
  return best
}

/** A point of the wall plane in plan coordinates. */
function planPoint(plane: WallPlane, frame: PlanFrame, x: number): Vec2 {
  const world = planeToWorld(plane, { x, y: 0 })
  return toPlan(frame, { x: world[0], y: world[1] })
}

/**
 * Place the openings of one wall. `plane` is the wall plane the openings were measured on,
 * in mesh coordinates; `baseAboveStreet` how far the plane's bottom sits above the part's
 * street level (the ground along one wall differs a little from the part's mean);
 * `heights` the storey heights from the street up.
 */
export function placeOpenings(
  openings: readonly MeasuredOpening[],
  plane: WallPlane,
  frame: PlanFrame,
  footprint: readonly Vec2[],
  heights: readonly number[],
  baseAboveStreet = 0,
): PlacementResult {
  const start = planPoint(plane, frame, 0)
  const end = planPoint(plane, frame, plane.width)
  const edgeIndex = matchEdge(start, end, footprint)
  if (edgeIndex === null) {
    return { placed: [], dropped: openings.map((opening) => ({ opening, reason: 'Wand passt zu keiner Grundrisskante' })), edge: null }
  }
  const edge = footprintEdges(footprint)[edgeIndex]!
  const placed: PlacedOpening[] = []
  const dropped: PlacementResult['dropped'] = []
  openings.forEach((opening, index) => {
    const result = placeOne(opening, index, plane, frame, edge, edgeIndex, heights, baseAboveStreet)
    if (typeof result === 'string') dropped.push({ opening, reason: result })
    else placed.push(result)
  })
  return { placed: resolveOverlaps(placed, dropped, openings), dropped, edge: edgeIndex }
}

function placeOne(
  opening: MeasuredOpening,
  source: number,
  plane: WallPlane,
  frame: PlanFrame,
  edge: Edge,
  edgeIndex: number,
  heights: readonly number[],
  baseAboveStreet: number,
): PlacedOpening | string {
  const messages: SurveyMessage[] = []
  // Horizontal: both ends onto the edge, then kept inside it.
  const left = along(edge, planPoint(plane, frame, opening.x))
  const right = along(edge, planPoint(plane, frame, opening.x + opening.width))
  const from = Math.max(0, Math.min(left, right))
  const to = Math.min(edge.length, Math.max(left, right))
  if (to - from < opening.width - 0.05) messages.push(message('survey.opening.wallEnd'))
  if (to - from < MIN_OPENING_M) return 'liegt außerhalb der Grundrisskante'

  // Vertical: heights above the street, then into the storey that holds most of it.
  const bottom = opening.y + baseAboveStreet
  const top = bottom + opening.height
  const total = heights.reduce((s, h) => s + h, 0)
  if (bottom >= total - MIN_OPENING_M) return 'liegt über der Traufe'
  const storey = storeyOf(Math.max(0, bottom), top, heights)
  const floor = floorLevel(storey, heights)
  const ceiling = floor + heights[storey]!
  let lower = Math.max(bottom, floor)
  let upper = Math.min(top, ceiling)
  if (lower > bottom + 0.01 || upper < top - 0.01) messages.push(message('survey.opening.slab'))
  let kind = opening.kind
  if (kind === 'door') {
    if (lower - floor <= DOOR_FLOOR_M) {
      lower = floor
    } else if (lower - floor <= DOOR_STEPS_M) {
      // Onto the floor with the height measured, so its area stays what the photo shows.
      messages.push(message('survey.opening.doorRaised', { height: Math.round((lower - floor) * 100) / 100 }))
      const measured = upper - lower
      lower = floor
      upper = floor + measured
    } else {
      kind = 'window'
      messages.push(message('survey.opening.doorAsWindow'))
    }
  }
  const height = upper - lower
  if (height < MIN_OPENING_M) return 'zu niedrig nach dem Zuschnitt auf das Geschoss'
  // Keep a hair inside the wall so rounding never reaches its end.
  // Rounded down to the millimetre so offset + width and sill + height never pass the end of
  // the wall or the ceiling, which the editor would reject.
  const offset = round(from)
  const sill = kind === 'door' ? 0 : round(lower - floor)
  return {
    kind,
    edge: edgeIndex,
    storey,
    offset,
    width: Math.max(EDITOR_MIN_M, roundDown(Math.min(to, edge.length) - offset)),
    height: Math.max(EDITOR_MIN_M, roundDown(Math.min(upper, ceiling) - floor - sill)),
    sill,
    score: opening.score,
    source,
    notes: messages.map(germanText),
    messages,
  }
}

function round(v: number): number {
  return Math.round(v * 1000) / 1000
}

function roundDown(v: number): number {
  return Math.floor(v * 1000 + 1e-6) / 1000
}

/**
 * Two openings on the same edge and storey may not overlap along the wall. The one with
 * the higher score stays; the other is shortened to the free part beside it, or dropped.
 * A glazed door found twice, as frame and as glass, ends as one door.
 */
function resolveOverlaps(
  placed: PlacedOpening[],
  dropped: PlacementResult['dropped'],
  measured: readonly MeasuredOpening[],
): PlacedOpening[] {
  const order = [...placed].sort((a, b) => (b.score ?? 1) - (a.score ?? 1))
  const kept: PlacedOpening[] = []
  for (const candidate of order) {
    let current: PlacedOpening | null = candidate
    for (const other of kept) {
      if (!current) break
      if (other.edge !== current.edge || other.storey !== current.storey) continue
      current = trimAgainst(current, other)
    }
    if (current) kept.push(current)
    else {
      const source = measured[candidate.source]
      if (source) dropped.push({ opening: source, reason: 'überlappt eine sicherere Öffnung' })
    }
  }
  return kept.sort((a, b) => a.storey - b.storey || a.offset - b.offset)
}

function trimAgainst(opening: PlacedOpening, other: PlacedOpening): PlacedOpening | null {
  const aStart = opening.offset
  const aEnd = opening.offset + opening.width
  const bStart = other.offset
  const bEnd = other.offset + other.width
  if (aEnd <= bStart + 1e-6 || bEnd <= aStart + 1e-6) return opening
  const leftFree = bStart - aStart
  const rightFree = aEnd - bEnd
  const overlap = message('survey.opening.overlap')
  const notes = { notes: [...opening.notes, germanText(overlap)], messages: [...opening.messages, overlap] }
  if (leftFree >= rightFree && leftFree >= MIN_OPENING_M) {
    return { ...opening, width: roundDown(leftFree), ...notes }
  }
  if (rightFree >= MIN_OPENING_M) return { ...opening, offset: round(bEnd), width: roundDown(aEnd - round(bEnd)), ...notes }
  return null
}
