/**
 * Lay a vertical wall polygon flat, so a photograph can be mapped onto it in metres.
 *
 * The wall keeps its real size: one unit along `u` or `v` is one metre of facade.
 */
import {
  azimuthDeg,
  cross,
  dot,
  newellNormal,
  normalize,
  ringArea3d,
  ringVertexCount,
  tiltDeg,
  type Vec3,
} from './geometry.ts'
import type { Point2 } from './photo.ts'

/** How far from vertical a surface may lean and still count as a wall. */
const MAX_WALL_LEAN_DEG = 10
const UP: Vec3 = [0, 0, 1]

export interface WallPlane {
  /** The ring's vertices in wall metres: u along the wall, v up, (0, 0) at the bottom left. */
  points: Point2[]
  width: number
  height: number
  /** 3D point (source CRS) that sits at (0, 0). */
  origin: Vec3
  /** Unit vector along the wall, left to right as seen from outside. */
  u: Vec3
  /** Unit vector straight up. */
  v: Vec3
  /** Unit outward normal of the wall. */
  normal: Vec3
  /** Compass bearing the wall faces, grid north = 0, east = 90. */
  azimuth: number
}

/**
 * Null when the ring is not a usable vertical wall: too few vertices, no area, or leaning
 * more than `MAX_WALL_LEAN_DEG` from vertical.
 */
export function wallToPlane(ring: number[], groundZ?: number): WallPlane | null {
  const usable = groundZ === undefined ? ring : clipRingAboveZ(ring, groundZ)
  return planeOfRing(usable)
}

function planeOfRing(ring: number[]): WallPlane | null {
  const count = ringVertexCount(ring)
  if (count < 3) return null

  const normal = normalize(newellNormal(ring))
  if (normal[0] === 0 && normal[1] === 0 && normal[2] === 0) return null
  if (Math.abs(tiltDeg(normal) - 90) > MAX_WALL_LEAN_DEG) return null

  // Along the wall, left to right for someone standing outside and facing it. Only the
  // horizontal part of the normal is used, so a slightly leaning wall still gets a level u.
  const flatNormal = normalize([normal[0], normal[1], 0])
  const u = normalize(cross(UP, flatNormal))
  const v = UP

  const raw: Point2[] = []
  for (let i = 0; i < count; i++) {
    const p: Vec3 = [ring[i * 3]!, ring[i * 3 + 1]!, ring[i * 3 + 2]!]
    raw.push({ x: dot(p, u), y: dot(p, v) })
  }

  let minU = Infinity
  let minV = Infinity
  let maxU = -Infinity
  let maxV = -Infinity
  for (const p of raw) {
    if (p.x < minU) minU = p.x
    if (p.y < minV) minV = p.y
    if (p.x > maxU) maxU = p.x
    if (p.y > maxV) maxV = p.y
  }

  const points = raw.map((p) => ({ x: p.x - minU, y: p.y - minV }))
  const origin = originFor(ring, u, minU, minV)

  return {
    points,
    width: maxU - minU,
    height: maxV - minV,
    origin,
    u,
    v,
    normal,
    azimuth: azimuthDeg(normal) ?? 0,
  }
}

/**
 * The 3D point that maps to (0, 0): start from any ring vertex and slide it back along u
 * and down along v to the bottom-left corner of the wall's bounding box.
 */
function originFor(ring: number[], u: Vec3, minU: number, minV: number): Vec3 {
  const first: Vec3 = [ring[0]!, ring[1]!, ring[2]!]
  const alongU = dot(first, u) - minU
  const alongV = first[2] - minV
  return [
    first[0] - u[0] * alongU,
    first[1] - u[1] * alongU,
    first[2] - alongV,
  ]
}

/** Go from wall metres back to a 3D point in the source CRS. */
export function planeToWorld(plane: WallPlane, point: Point2): Vec3 {
  return [
    plane.origin[0] + plane.u[0] * point.x + plane.v[0] * point.y,
    plane.origin[1] + plane.u[1] * point.x + plane.v[1] * point.y,
    plane.origin[2] + plane.u[2] * point.x + plane.v[2] * point.y,
  ]
}

/**
 * True area of the wall polygon in m², as the model holds it. Smaller than width x height
 * for a gable. With `groundZ`, only the part above that height counts.
 */
export function wallArea(ring: number[], groundZ?: number): number {
  const usable = groundZ === undefined ? ring : clipRingAboveZ(ring, groundZ)
  return ringArea3d(usable)
}

/** How close (in plan, metres) a contact-line vertex must be to the wall to count as its ground. */
const GROUND_SEARCH_M = 0.5

/**
 * Street level along this wall, from the building's terrain contact line: the mean height
 * of the line's vertices that lie on the wall's base in plan view. Null when none do.
 *
 * LoD2 models no basement, so a wall's lowest vertex is the floor slab, which can be many
 * metres below the street. The contact line is the only place the data says where the
 * ground actually is.
 */
export function wallGroundLevel(ring: number[], terrainRings: readonly number[][]): number | null {
  const count = ringVertexCount(ring)
  if (count < 2) return null
  let sum = 0
  let n = 0
  // A closed line repeats its first vertex, and lines share their end points. Count each
  // place once, so a repeated vertex does not weigh twice in the mean.
  const seen = new Set<string>()
  for (const line of terrainRings) {
    for (let i = 0; i + 2 < line.length; i += 3) {
      const x = line[i]!
      const y = line[i + 1]!
      const key = `${Math.round(x * 1000)},${Math.round(y * 1000)}`
      if (seen.has(key)) continue
      seen.add(key)
      if (distanceToRingInPlan(ring, count, x, y) <= GROUND_SEARCH_M) {
        sum += line[i + 2]!
        n++
      }
    }
  }
  return n ? sum / n : null
}

/** Shortest distance in plan view from (x, y) to any edge of the ring. */
function distanceToRingInPlan(ring: number[], count: number, x: number, y: number): number {
  let best = Infinity
  for (let i = 0; i < count; i++) {
    const j = (i + 1) % count
    const d = pointToSegment2d(x, y, ring[i * 3]!, ring[i * 3 + 1]!, ring[j * 3]!, ring[j * 3 + 1]!)
    if (d < best) best = d
  }
  return best
}

function pointToSegment2d(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  const ex = bx - ax
  const ey = by - ay
  const len2 = ex * ex + ey * ey
  const t = len2 === 0 ? 0 : Math.min(1, Math.max(0, ((px - ax) * ex + (py - ay) * ey) / len2))
  return Math.hypot(px - (ax + t * ex), py - (ay + t * ey))
}

/**
 * The part of a closed ring at or above height z, as a closed ring. Each edge that crosses
 * the plane is cut at the crossing point. An empty array when nothing is above z.
 */
export function clipRingAboveZ(ring: number[], z: number): number[] {
  const count = ringVertexCount(ring)
  if (count < 3) return []
  const out: number[] = []
  for (let i = 0; i < count; i++) {
    const j = (i + 1) % count
    const a: Vec3 = [ring[i * 3]!, ring[i * 3 + 1]!, ring[i * 3 + 2]!]
    const b: Vec3 = [ring[j * 3]!, ring[j * 3 + 1]!, ring[j * 3 + 2]!]
    const aAbove = a[2] >= z
    const bAbove = b[2] >= z
    if (aAbove) out.push(...a)
    if (aAbove !== bAbove) out.push(...crossingAtZ(a, b, z))
  }
  if (out.length < 9) return []
  out.push(out[0]!, out[1]!, out[2]!)
  return out
}

function crossingAtZ(a: Vec3, b: Vec3, z: number): Vec3 {
  const t = (z - a[2]) / (b[2] - a[2])
  return [a[0] + t * (b[0] - a[0]), a[1] + t * (b[1] - a[1]), z]
}

/**
 * Compass bearing the surface faces, from its outward normal: 0 = grid north, 90 = east.
 * Null for a horizontal face. Relies on the ring being wound outward, as AdV data is.
 */
export function wallAzimuth(ring: number[]): number | null {
  return azimuthDeg(newellNormal(ring))
}
