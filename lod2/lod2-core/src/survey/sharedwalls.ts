/**
 * Walls a building shares with its neighbour.
 *
 * In a Berlin block most side walls are fire walls against the next building, which is
 * heated too. They lose almost no heat, and counting them as outside walls roughly doubles
 * the wall losses of a terraced house. LoD2 does not mark them, but the neighbour's footprint
 * lies right against them, running the other way.
 */
import type { Vec2 } from './footprint.ts'
import { footprintEdges } from './placeopenings.ts'

/** A neighbour edge counts when it is this close to the line and this parallel. */
const SHARED_DISTANCE_M = 0.3
const SHARED_ANGLE_DEG = 10
/** At least this much of an edge must be covered to call the whole edge shared. */
const SHARED_FRACTION = 0.5

export interface SharedEdge {
  edge: number
  /** Share of the edge's length that touches a neighbour, 0 to 1. */
  covered: number
}

/**
 * The footprint edges that lie against a neighbour's edge. `neighbours` are footprints in
 * the same plan frame. An edge is shared when neighbours cover at least half its length.
 */
export function sharedEdges(footprint: readonly Vec2[], neighbours: readonly (readonly Vec2[])[]): SharedEdge[] {
  const own = footprintEdges(footprint)
  const others = neighbours.flatMap((n) => footprintEdges(n))
  const minCos = Math.cos((SHARED_ANGLE_DEG * Math.PI) / 180)
  const result: SharedEdge[] = []
  own.forEach((edge, index) => {
    const intervals: [number, number][] = []
    for (const other of others) {
      // A neighbour's edge along the same wall runs the other way round its own footprint.
      const cos = -(edge.dir.x * other.dir.x + edge.dir.y * other.dir.y)
      if (cos < minCos) continue
      if (lineDistance(edge, other.a) > SHARED_DISTANCE_M || lineDistance(edge, other.b) > SHARED_DISTANCE_M) continue
      const s = alongEdge(edge, other.a)
      const t = alongEdge(edge, other.b)
      const from = Math.max(0, Math.min(s, t))
      const to = Math.min(edge.length, Math.max(s, t))
      if (to > from) intervals.push([from, to])
    }
    const covered = unionLength(intervals) / edge.length
    if (covered >= SHARED_FRACTION) result.push({ edge: index, covered: Math.min(1, covered) })
  })
  return result
}

function alongEdge(edge: { a: Vec2; dir: Vec2 }, p: Vec2): number {
  return (p.x - edge.a.x) * edge.dir.x + (p.y - edge.a.y) * edge.dir.y
}

function lineDistance(edge: { a: Vec2; dir: Vec2 }, p: Vec2): number {
  return Math.abs((p.x - edge.a.x) * edge.dir.y - (p.y - edge.a.y) * edge.dir.x)
}

/** Total length covered by possibly overlapping intervals. */
export function unionLength(intervals: readonly [number, number][]): number {
  const sorted = [...intervals].sort((a, b) => a[0] - b[0])
  let total = 0
  let end = -Infinity
  for (const [from, to] of sorted) {
    if (to <= end) continue
    total += to - Math.max(from, end)
    end = to
  }
  return total
}

