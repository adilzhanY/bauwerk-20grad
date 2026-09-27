/**
 * A building part's footprint in plan, cleaned for an editor.
 *
 * LoD2 ground rings carry millimetre steps, repeated vertices and slight bends where two
 * cadastral lines meet. An editor needs straight walls it can put windows on, so these are
 * removed, but never at the price of changing the area by more than a percent.
 */

export interface Vec2 {
  x: number
  y: number
}

/** Vertices closer than this are one vertex. */
const DUPLICATE_M = 0.05
/** A corner that turns less than this is a straight wall. */
const STRAIGHT_DEG = 3
/** Edges shorter than this are merged into their neighbours. */
const SHORT_EDGE_M = 0.25
/** Simplification may not change the area by more than this fraction. */
const MAX_AREA_CHANGE = 0.01

/** Signed area, positive for counter-clockwise. */
export function signedArea(polygon: readonly Vec2[]): number {
  let sum = 0
  for (let i = 0; i < polygon.length; i++) {
    const a = polygon[i]!
    const b = polygon[(i + 1) % polygon.length]!
    sum += a.x * b.y - b.x * a.y
  }
  return sum / 2
}

export function polygonArea(polygon: readonly Vec2[]): number {
  return Math.abs(signedArea(polygon))
}

/** The polygon counter-clockwise, as Bauwerk expects it. */
export function counterClockwise(polygon: readonly Vec2[]): Vec2[] {
  return signedArea(polygon) >= 0 ? [...polygon] : [...polygon].reverse()
}

/**
 * The plan outline of a ground ring (x y z triples, possibly closed), without its closing
 * vertex, counter-clockwise.
 */
export function ringToPlan(ring: readonly number[]): Vec2[] {
  const points: Vec2[] = []
  for (let i = 0; i + 2 < ring.length; i += 3) points.push({ x: ring[i]!, y: ring[i + 1]! })
  const first = points[0]
  const last = points[points.length - 1]
  if (first && last && points.length > 1 && distance(first, last) < 1e-9) points.pop()
  return counterClockwise(points)
}

export function distance(a: Vec2, b: Vec2): number {
  return Math.hypot(a.x - b.x, a.y - b.y)
}

/** Drop vertices that sit on top of the previous one. */
export function removeDuplicates(polygon: readonly Vec2[]): Vec2[] {
  const out: Vec2[] = []
  for (const p of polygon) {
    const previous = out[out.length - 1]
    if (!previous || distance(previous, p) >= DUPLICATE_M) out.push(p)
  }
  while (out.length > 1 && distance(out[0]!, out[out.length - 1]!) < DUPLICATE_M) out.pop()
  return out
}

/** How much the path turns at `b`, in degrees, 0 for straight on. */
export function turnDeg(a: Vec2, b: Vec2, c: Vec2): number {
  const inAngle = Math.atan2(b.y - a.y, b.x - a.x)
  const outAngle = Math.atan2(c.y - b.y, c.x - b.x)
  let turn = Math.abs(outAngle - inAngle) * (180 / Math.PI)
  if (turn > 180) turn = 360 - turn
  return turn
}

/**
 * Remove corners that are really straight walls and edges too short to hold a window,
 * one vertex at a time, as long as the polygon stays simple and its area stays within
 * `MAX_AREA_CHANGE` of the original.
 */
export function simplifyFootprint(polygon: readonly Vec2[]): Vec2[] {
  const original = polygonArea(polygon)
  const deduplicated = removeDuplicates(polygon)
  // On a very small part even merging close vertices can move the area; then keep them.
  const dedupChange = Math.abs(polygonArea(deduplicated) - original) / original
  let current = dedupChange <= MAX_AREA_CHANGE && isSimplePolygon(deduplicated) ? deduplicated : [...polygon]
  let changed = true
  while (changed && current.length > 3) {
    changed = false
    const index = weakestVertex(current)
    if (index === null) break
    const candidate = current.filter((_, i) => i !== index)
    const areaChange = Math.abs(polygonArea(candidate) - original) / original
    if (areaChange <= MAX_AREA_CHANGE && isSimplePolygon(candidate)) {
      current = candidate
      changed = true
    }
  }
  return current
}

/**
 * The vertex most worth removing: the straightest corner below `STRAIGHT_DEG`, else an end
 * of the shortest edge below `SHORT_EDGE_M`. Null when every vertex is a real corner.
 */
function weakestVertex(polygon: readonly Vec2[]): number | null {
  const n = polygon.length
  let best: number | null = null
  let bestTurn = STRAIGHT_DEG
  for (let i = 0; i < n; i++) {
    const turn = turnDeg(polygon[(i + n - 1) % n]!, polygon[i]!, polygon[(i + 1) % n]!)
    if (turn < bestTurn) {
      bestTurn = turn
      best = i
    }
  }
  if (best !== null) return best
  let shortest = SHORT_EDGE_M
  for (let i = 0; i < n; i++) {
    const length = distance(polygon[i]!, polygon[(i + 1) % n]!)
    if (length < shortest) {
      shortest = length
      best = i
    }
  }
  return best
}

/** True when no two non-adjacent edges cross and there are at least three vertices. */
export function isSimplePolygon(polygon: readonly Vec2[]): boolean {
  const n = polygon.length
  if (n < 3) return false
  for (let i = 0; i < n; i++) {
    const a = polygon[i]!
    const b = polygon[(i + 1) % n]!
    for (let j = i + 1; j < n; j++) {
      if (j === i || (j + 1) % n === i || (i + 1) % n === j) continue
      if (segmentsCross(a, b, polygon[j]!, polygon[(j + 1) % n]!)) return false
    }
  }
  return polygonArea(polygon) > 1e-9
}

function segmentsCross(a: Vec2, b: Vec2, c: Vec2, d: Vec2): boolean {
  const d1 = side(c, d, a)
  const d2 = side(c, d, b)
  const d3 = side(a, b, c)
  const d4 = side(a, b, d)
  return d1 * d2 < 0 && d3 * d4 < 0
}

function side(a: Vec2, b: Vec2, p: Vec2): number {
  return (b.x - a.x) * (p.y - a.y) - (b.y - a.y) * (p.x - a.x)
}

/**
 * The direction of the building, in radians from plan x, between 0 and pi / 2: every edge
 * votes for its angle modulo 90 degrees with its length, so the long street walls decide.
 */
export function dominantAngle(polygon: readonly Vec2[]): number {
  // Average on the circle of 4 x angle, so 1 and 89 degrees count as neighbours.
  let sx = 0
  let sy = 0
  for (let i = 0; i < polygon.length; i++) {
    const a = polygon[i]!
    const b = polygon[(i + 1) % polygon.length]!
    const length = distance(a, b)
    const angle = Math.atan2(b.y - a.y, b.x - a.x)
    sx += length * Math.cos(4 * angle)
    sy += length * Math.sin(4 * angle)
  }
  const quarter = Math.atan2(sy, sx) / 4
  return quarter < 0 ? quarter + Math.PI / 2 : quarter
}

/** Rotate a point about the origin by `angle` radians, counter-clockwise. */
export function rotate(p: Vec2, angle: number): Vec2 {
  const c = Math.cos(angle)
  const s = Math.sin(angle)
  return { x: c * p.x - s * p.y, y: s * p.x + c * p.y }
}

export function centroidOf(polygon: readonly Vec2[]): Vec2 {
  // Area centroid, so a dense run of vertices on one side does not pull it.
  let cx = 0
  let cy = 0
  let twiceArea = 0
  for (let i = 0; i < polygon.length; i++) {
    const a = polygon[i]!
    const b = polygon[(i + 1) % polygon.length]!
    const cross = a.x * b.y - b.x * a.y
    twiceArea += cross
    cx += (a.x + b.x) * cross
    cy += (a.y + b.y) * cross
  }
  if (Math.abs(twiceArea) < 1e-12) return polygon[0] ?? { x: 0, y: 0 }
  return { x: cx / (3 * twiceArea), y: cy / (3 * twiceArea) }
}

/**
 * How a point in the mesh frame (x east, y north, metres) becomes a point in the editor's
 * plan: move the footprint's centroid to the origin, then turn the building so its main
 * walls run along the plan axes.
 */
export interface PlanFrame {
  /** Mesh-frame point that becomes the plan origin. */
  center: Vec2
  /** Rotation applied to mesh-frame vectors, radians, counter-clockwise. */
  angle: number
  /** Compass bearing of plan +y, degrees clockwise from north, 0 to 360. */
  bearing: number
}

export function planFrameFor(footprint: readonly Vec2[]): PlanFrame {
  const center = centroidOf(footprint)
  // Turning by minus the dominant angle lays the main walls along plan x.
  let angle = -dominantAngle(footprint)
  // Prefer the smaller turn: a building at 80 degrees turns by +10, not by -80.
  if (angle < -Math.PI / 4) angle += Math.PI / 2
  // Plan +y is the mesh vector rotate((0, 1), -angle); its compass bearing is measured
  // clockwise from north (mesh +y).
  const up = rotate({ x: 0, y: 1 }, -angle)
  let bearing = (Math.atan2(up.x, up.y) * 180) / Math.PI
  if (bearing < 0) bearing += 360
  if (bearing >= 360) bearing -= 360
  return { center, angle, bearing }
}

export function toPlan(frame: PlanFrame, meshPoint: Vec2): Vec2 {
  return rotate({ x: meshPoint.x - frame.center.x, y: meshPoint.y - frame.center.y }, frame.angle)
}

export function toMesh(frame: PlanFrame, planPoint: Vec2): Vec2 {
  const back = rotate(planPoint, -frame.angle)
  return { x: back.x + frame.center.x, y: back.y + frame.center.y }
}

/**
 * Square the corners that are within `toleranceDeg` of a right angle in the plan frame, by
 * snapping each edge that is almost axis-parallel onto the axis through its midpoint. Returns
 * null when that would break the polygon or change its area by more than 2 percent.
 */
export function squareCorners(planFootprint: readonly Vec2[], toleranceDeg = 5): Vec2[] | null {
  const n = planFootprint.length
  const tolerance = (toleranceDeg * Math.PI) / 180
  // For each edge: 'x' when it should run along plan x, 'y' along plan y, null otherwise.
  const axes = planFootprint.map((a, i) => {
    const b = planFootprint[(i + 1) % n]!
    const angle = Math.atan2(b.y - a.y, b.x - a.x)
    const fromX = Math.abs(Math.sin(angle))
    const fromY = Math.abs(Math.cos(angle))
    if (Math.asin(Math.min(1, fromX)) <= tolerance) return { axis: 'x' as const, at: (a.y + b.y) / 2 }
    if (Math.asin(Math.min(1, fromY)) <= tolerance) return { axis: 'y' as const, at: (a.x + b.x) / 2 }
    return null
  })
  const squared = planFootprint.map((p, i) => {
    const before = axes[(i + n - 1) % n]
    const after = axes[i]
    let { x, y } = p
    for (const edge of [before, after]) {
      if (edge?.axis === 'x') y = edge.at
      if (edge?.axis === 'y') x = edge.at
    }
    return { x, y }
  })
  const original = polygonArea(planFootprint)
  const change = Math.abs(polygonArea(squared) - original) / original
  if (change > 0.02 || !isSimplePolygon(removeDuplicates(squared))) return null
  return removeDuplicates(squared)
}
