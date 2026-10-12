import { add, edges, lineIntersection, scale, sub } from "./polygon";
import type { Edge } from "./polygon";
import { countedOpenings } from "./openings";
import type { Opening, Segment, Vec2 } from "./types";

/**
 * An exterior wall as a footprint quad. The building footprint is the outer
 * face of the walls; the inner face is offset inward by the wall thickness and
 * the corners are mitred so neighbouring walls meet without gaps or overlaps.
 *
 * `length` is the outer edge length, which is what opening offsets measure.
 */
export interface Wall {
  index: number;
  outerA: Vec2;
  outerB: Vec2;
  innerA: Vec2;
  innerB: Vec2;
  /** Outer length in metres. */
  length: number;
  /** Unit vector along the outer edge from A to B. */
  direction: Vec2;
  /** Unit outward normal. */
  normal: Vec2;
  /** Storey height in metres. */
  height: number;
  /** Quad in drawing order: outerA, outerB, innerB, innerA. */
  quad: [Vec2, Vec2, Vec2, Vec2];
}

function offsetLine(edge: Edge, thickness: number): [Vec2, Vec2] {
  const shift = scale(edge.normal, -thickness);
  return [add(edge.a, shift), add(edge.b, shift)];
}

/**
 * Builds every exterior wall for a counter-clockwise footprint. Returns one wall
 * per footprint vertex.
 */
export function buildWalls(footprint: readonly Vec2[], thickness: number, height: number): Wall[] {
  const es = edges(footprint);
  const n = es.length;
  const inner = es.map((e) => offsetLine(e, thickness));
  const innerCorners: Vec2[] = [];
  for (let i = 0; i < n; i++) {
    const prev = inner[(i + n - 1) % n];
    const curr = inner[i];
    if (!prev || !curr) continue;
    // Corner i is where the inner line of edge i-1 meets the inner line of edge i.
    const meet = lineIntersection(prev[0], prev[1], curr[0], curr[1]) ?? curr[0];
    innerCorners.push(meet);
  }
  return es.map((e, i) => {
    const innerA = innerCorners[i] ?? e.a;
    const innerB = innerCorners[(i + 1) % n] ?? e.b;
    return {
      index: i,
      outerA: e.a,
      outerB: e.b,
      innerA,
      innerB,
      length: e.length,
      direction: e.direction,
      normal: e.normal,
      height,
      quad: [e.a, e.b, innerB, innerA],
    };
  });
}

/**
 * An interior wall in the same shape as an exterior one, so openings, solids and
 * the scene treat both alike. The segment is the wall's centre line; the "outer"
 * face is on the left of a to b and opening offsets run from a.
 */
export function interiorWallAsWall(
  segment: Segment,
  index: number,
  height: number,
  /** Metres, from the wall's type (geometry/constructions.ts interiorWallThickness). */
  thickness: number,
): Wall {
  const d = sub(segment.b, segment.a);
  const length = Math.hypot(d.x, d.y);
  const direction = length > 0 ? { x: d.x / length, y: d.y / length } : { x: 1, y: 0 };
  const normal = { x: direction.y, y: -direction.x };
  const half = scale(normal, thickness / 2);
  const outerA = add(segment.a, half);
  const outerB = add(segment.b, half);
  const innerA = sub(segment.a, half);
  const innerB = sub(segment.b, half);
  return {
    index,
    outerA,
    outerB,
    innerA,
    innerB,
    length,
    direction,
    normal,
    height,
    quad: [outerA, outerB, innerB, innerA],
  };
}

/** Perpendicular distance between the outer and inner face at a point along the wall. */
export function wallThicknessAt(wall: Wall, t: number): number {
  const outer = add(wall.outerA, scale(sub(wall.outerB, wall.outerA), t));
  const inner = add(wall.innerA, scale(sub(wall.innerB, wall.innerA), t));
  const d = sub(outer, inner);
  return Math.abs(d.x * wall.normal.x + d.y * wall.normal.y);
}

/**
 * A wall as a set of solid prisms. Each prism is a plan quad in world XZ metres
 * (as x, y here) with a bottom and top height. Openings are the gaps between
 * prisms: a column that holds an opening is split into a part below the sill
 * and a part above the head. This avoids CSG entirely and the volume is easy
 * to check in a test. Invalid openings are ignored.
 */
export interface WallPrism {
  plan: [Vec2, Vec2, Vec2, Vec2];
  bottom: number;
  top: number;
}

interface Column {
  u0: number;
  u1: number;
  cuts: { v0: number; v1: number }[];
}

export function wallSolids(
  wall: Wall,
  openings: readonly Opening[],
  /**
   * The part of the wall that is built, metres along it: all of it, or for an interior wall
   * where it is seen (wallGraph.pieceRange), so it does not run into the walls it meets.
   * Only the solid is cut; the wall's length and its openings are unchanged.
   */
  range: [number, number] = [0, wall.length],
): WallPrism[] {
  const valid = countedOpenings(openings, wall.length, wall.height);
  const sorted = [...valid].sort((a, b) => a.offset - b.offset);
  const columns: Column[] = [];
  let cursor = 0;
  for (const o of sorted) {
    if (o.offset > cursor + 1e-9) columns.push({ u0: cursor, u1: o.offset, cuts: [] });
    columns.push({
      u0: o.offset,
      u1: o.offset + o.width,
      cuts: [{ v0: o.sill, v1: o.sill + o.height }],
    });
    cursor = o.offset + o.width;
  }
  if (cursor < wall.length - 1e-9) columns.push({ u0: cursor, u1: wall.length, cuts: [] });

  const [from, to] = range;
  const prisms: WallPrism[] = [];
  for (const column of columns) {
    const c = { ...column, u0: Math.max(column.u0, from), u1: Math.min(column.u1, to) };
    // The first and last columns stretch to a range that reaches past the wall's ends.
    if (column.u0 <= 1e-9) c.u0 = from;
    if (column.u1 >= wall.length - 1e-9) c.u1 = to;
    if (c.u1 - c.u0 <= 1e-9) continue;
    const plan = wallPlanSlice(wall, c.u0, c.u1);
    const cut = c.cuts[0];
    if (!cut) {
      prisms.push({ plan, bottom: 0, top: wall.height });
      continue;
    }
    if (cut.v0 > 1e-9) prisms.push({ plan, bottom: 0, top: cut.v0 });
    if (cut.v1 < wall.height - 1e-9) prisms.push({ plan, bottom: cut.v1, top: wall.height });
  }
  return prisms;
}

/**
 * Plan quad of the wall between u0 and u1 metres along the outer edge. The
 * inner side follows the mitred inner face, so the end slices meet their
 * neighbours exactly at the corners.
 */
export function wallPlanSlice(wall: Wall, u0: number, u1: number): [Vec2, Vec2, Vec2, Vec2] {
  const outer = (u: number) => add(wall.outerA, scale(wall.direction, u));
  const innerDir = sub(wall.innerB, wall.innerA);
  const innerLen = Math.hypot(innerDir.x, innerDir.y);
  const inner = (u: number): Vec2 => {
    if (u <= 1e-9) return wall.innerA;
    if (u >= wall.length - 1e-9) return wall.innerB;
    // Project the outer point onto the inner face along the inward normal, then
    // clamp to the inner segment so a slice never pokes past a mitred corner.
    const p = add(outer(u), scale(wall.normal, -wallThicknessAt(wall, 0.5)));
    if (innerLen < 1e-9) return p;
    const t =
      ((p.x - wall.innerA.x) * innerDir.x + (p.y - wall.innerA.y) * innerDir.y) /
      (innerLen * innerLen);
    return add(wall.innerA, scale(innerDir, Math.min(1, Math.max(0, t))));
  };
  return [outer(u0), outer(u1), inner(u1), inner(u0)];
}
