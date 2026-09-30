import { isOpeningValid } from "./openings";
import {
  add,
  centroid,
  cross,
  distance,
  dot,
  ensureCounterClockwise,
  lineIntersection,
  pointInPolygon,
  scale,
  sub,
} from "./polygon";
import type { InteriorWall, Opening, Segment, ThicknessOf, Vec2 } from "./types";
import { wallPlanSlice } from "./walls";
import type { Wall } from "./walls";

/**
 * The 2D plan drawing of a storey, as an architect draws it: walls cut and filled between
 * their faces, openings as breaks in the wall with their symbol, and dimension lines outside.
 * Everything is plan metres; the scene lifts it onto the storey.
 */

export type PlanLine = [Vec2, Vec2];

/**
 * The solid parts of a wall in plan: the wall quad minus every valid opening, within `range`
 * (metres along it). An interior wall passes its clear part, so it is not drawn into the
 * walls it meets (clearWallRange).
 */
export function wallPoche(
  wall: Wall,
  openings: readonly Opening[],
  range: [number, number] = [0, wall.length],
): Vec2[][] {
  const [from, to] = range;
  const spans = openingSpans(wall, openings);
  const solids: Vec2[][] = [];
  let cursor = from;
  for (const [u0, u1] of spans) {
    if (u0 > cursor + 1e-9) solids.push(wallPlanSlice(wall, cursor, Math.min(u0, to)));
    cursor = Math.max(cursor, u1);
  }
  if (cursor < to - 1e-9) solids.push(wallPlanSlice(wall, cursor, to));
  return solids;
}

/** Valid openings as [start, end] metres along the outer face, sorted. */
export function openingSpans(wall: Wall, openings: readonly Opening[]): [number, number][] {
  return openings
    .filter((o) =>
      isOpeningValid(o, { wallLength: wall.length, storeyHeight: wall.height, siblings: openings }),
    )
    .map((o): [number, number] => [o.offset, o.offset + o.width])
    .sort((a, b) => a[0] - b[0]);
}

export interface OpeningSymbol {
  /** The two cut ends of the wall on either side of the opening. */
  jambs: PlanLine[];
  /** Windows: the outer sill, the frame as two lines, the inner sill. Doors: the threshold. */
  lines: PlanLine[];
  /** Doors: the leaf standing open into the room, hinged at the start of the opening. */
  leaf: PlanLine | null;
  /** Doors: the quarter circle the leaf sweeps. */
  arc: Vec2[];
}

const ARC_STEPS = 16;
/** Half the distance between the two frame lines of a window, metres. */
const FRAME_HALF = 0.035;

/** The plan symbol of one opening in its wall. */
export function openingSymbol(wall: Wall, opening: Opening): OpeningSymbol {
  const u0 = opening.offset;
  const u1 = opening.offset + opening.width;
  const [outer0, outer1, inner1, inner0] = wallPlanSlice(wall, u0, u1);
  const jambs: PlanLine[] = [
    [outer0, inner0],
    [outer1, inner1],
  ];
  if (opening.kind === "window") {
    // DIN 1356: the frame as a double line in the middle of the wall, between the sills.
    const across = (a: Vec2, b: Vec2, t: number): Vec2 => add(a, scale(sub(b, a), t));
    const frame = Math.min(0.25, FRAME_HALF / Math.max(distance(outer0, inner0), 1e-6));
    return {
      jambs,
      lines: [
        [outer0, outer1],
        [across(outer0, inner0, 0.5 - frame), across(outer1, inner1, 0.5 - frame)],
        [across(outer0, inner0, 0.5 + frame), across(outer1, inner1, 0.5 + frame)],
        [inner0, inner1],
      ],
      leaf: null,
      arc: [],
    };
  }
  // The door opens into the building: away from the outer face, hinged at the start.
  const inward = scale(wall.normal, -1);
  const open = add(inner0, scale(inward, opening.width));
  const arc: Vec2[] = [];
  const closed = sub(inner1, inner0);
  for (let i = 0; i <= ARC_STEPS; i++) {
    const t = (i / ARC_STEPS) * (Math.PI / 2);
    // From the open leaf back to the closed position across the gap.
    arc.push(
      add(inner0, add(scale(inward, opening.width * Math.cos(t)), scale(closed, Math.sin(t)))),
    );
  }
  return { jambs, lines: [[inner0, inner1]], leaf: [inner0, open], arc };
}

/** A filled arrowhead: the tip, then the two corners of its back. */
export type Arrowhead = [Vec2, Vec2, Vec2];

export interface Dimension {
  /** The dimension line, parallel to the measured distance. */
  line: PlanLine;
  /** Extension lines from near the measured points to just past the dimension line. */
  extensions: PlanLine[];
  /** An arrowhead at each end, its tip on the measured point's extension line. */
  arrows: Arrowhead[];
  /** Where the label sits: the middle of the dimension line. */
  label: Vec2;
  /** The measured distance in metres. */
  length: number;
  /** Set when the piece is an opening, which is labelled width over height. */
  opening?: Opening;
}

/** The small sizes of a dimension, in metres, so a caller can keep them constant on screen. */
export interface DimensionStyle {
  /** Gap between the measured point and the start of an extension line. */
  gap: number;
  /** How far an extension line runs past the dimension line. */
  overrun: number;
  /** Length of an arrowhead. */
  arrow: number;
}

export const DEFAULT_DIMENSION_STYLE: DimensionStyle = { gap: 0.15, overrun: 0.2, arrow: 0.2 };

/** An arrowhead's half width, as a share of its length: slim, as drawn by hand. */
const ARROW_HALF_WIDTH = 0.28;
/** Below this many arrow lengths the arrows go outside the line and point in. */
const ARROWS_INSIDE = 2.5;

function arrowhead(tip: Vec2, pointing: Vec2, length: number): Arrowhead {
  const back = sub(tip, scale(pointing, length));
  const side = scale({ x: -pointing.y, y: pointing.x }, length * ARROW_HALF_WIDTH);
  return [tip, add(back, side), sub(back, side)];
}

/**
 * An architect's dimension between two points, drawn `offset` metres out along `normal`:
 * the line, the extension lines back toward the points, and an arrowhead at each end
 * pointing at its extension line. A distance too short for two arrows between its ends
 * gets them outside, pointing in, with the line running on past the ends to carry them.
 */
export function dimension(
  a: Vec2,
  b: Vec2,
  normal: Vec2,
  offset: number,
  style: DimensionStyle = DEFAULT_DIMENSION_STYLE,
): Dimension {
  const out = (p: Vec2, k: number) => add(p, scale(normal, k));
  const lineA = out(a, offset);
  const lineB = out(b, offset);
  const d = sub(b, a);
  const length = Math.hypot(d.x, d.y);
  const along = length > 0 ? scale(d, 1 / length) : { x: 1, y: 0 };
  const back = scale(along, -1);
  const inside = length >= ARROWS_INSIDE * style.arrow;
  const tail = scale(along, style.arrow * 1.6);
  return {
    line: inside ? [lineA, lineB] : [sub(lineA, tail), add(lineB, tail)],
    extensions: [
      [out(a, style.gap), out(a, offset + style.overrun)],
      [out(b, style.gap), out(b, offset + style.overrun)],
    ],
    arrows: inside
      ? [arrowhead(lineA, back, style.arrow), arrowhead(lineB, along, style.arrow)]
      : [arrowhead(lineA, along, style.arrow), arrowhead(lineB, back, style.arrow)],
    label: scale(add(lineA, lineB), 0.5),
    length,
  };
}

/** A clear span between two walls, as written across a room: arrows onto the walls, no extension lines. */
export function span(a: Vec2, b: Vec2, style: DimensionStyle = DEFAULT_DIMENSION_STYLE): Dimension {
  return { ...dimension(a, b, { x: 0, y: 0 }, 0, style), extensions: [] };
}

/**
 * Where the line through `p` along `direction` leaves the polygon on either side: the
 * nearest boundary crossing behind and ahead. Null when `p` is not enclosed that way.
 */
export function spanThrough(
  polygon: readonly Vec2[],
  p: Vec2,
  direction: Vec2,
): [Vec2, Vec2] | null {
  let behind = -Infinity;
  let ahead = Infinity;
  for (let i = 0; i < polygon.length; i++) {
    const a = polygon[i];
    const b = polygon[(i + 1) % polygon.length];
    if (!a || !b) continue;
    const e = sub(b, a);
    const denom = cross(direction, e);
    if (Math.abs(denom) < 1e-12) continue;
    const ap = sub(a, p);
    const t = cross(ap, e) / denom;
    const s = cross(ap, direction) / denom;
    if (s < -1e-9 || s > 1 + 1e-9) continue;
    if (t > 1e-9) ahead = Math.min(ahead, t);
    else if (t < -1e-9) behind = Math.max(behind, t);
  }
  if (!Number.isFinite(behind) || !Number.isFinite(ahead)) return null;
  return [add(p, scale(direction, behind)), add(p, scale(direction, ahead))];
}

/** The longest stretch inside the polygon of the whole line through `p` along `direction`. */
function longestInside(polygon: readonly Vec2[], p: Vec2, direction: Vec2): [Vec2, Vec2] | null {
  const ts: number[] = [];
  for (let i = 0; i < polygon.length; i++) {
    const a = polygon[i];
    const b = polygon[(i + 1) % polygon.length];
    if (!a || !b) continue;
    const e = sub(b, a);
    const denom = cross(direction, e);
    if (Math.abs(denom) < 1e-12) continue;
    const ap = sub(a, p);
    const s = cross(ap, direction) / denom;
    if (s >= -1e-9 && s <= 1 + 1e-9) ts.push(cross(ap, e) / denom);
  }
  ts.sort((x, y) => x - y);
  const at = (t: number) => add(p, scale(direction, t));
  let best: [Vec2, Vec2] | null = null;
  let bestLength = 0;
  for (let i = 0; i + 1 < ts.length; i++) {
    const t0 = ts[i] ?? 0;
    const t1 = ts[i + 1] ?? 0;
    if (t1 - t0 > bestLength && pointInPolygon(at((t0 + t1) / 2), polygon)) {
      best = [at(t0), at(t1)];
      bestLength = t1 - t0;
    }
  }
  return best;
}

/** Distance from `p` to the infinite line through `a` and `b`. */
function lineDistance(p: Vec2, a: Vec2, b: Vec2): number {
  const d = sub(b, a);
  const l = Math.hypot(d.x, d.y);
  return l > 0 ? Math.abs(cross(d, sub(p, a))) / l : distance(p, a);
}

/**
 * The clear floor of a room: its outline moved in by the walls around it. Rooms are stored
 * on the building's outer face and on the centre line of interior walls, so a size measured
 * on the stored outline runs into the walls. An edge on the footprint moves in by the
 * exterior wall's thickness, an edge on an interior wall by half that wall.
 */
export function clearRoomPolygon(
  polygon: readonly Vec2[],
  footprint: readonly Vec2[],
  exteriorThickness: number,
  walls: readonly InteriorWall[],
  thicknessOf: ThicknessOf,
): Vec2[] {
  const ring = ensureCounterClockwise(polygon);
  const n = ring.length;
  const onOutline = (a: Vec2, b: Vec2) =>
    footprint.some((f, i) => {
      const g = footprint[(i + 1) % footprint.length] ?? f;
      return lineDistance(a, f, g) < 1e-6 && lineDistance(b, f, g) < 1e-6;
    });
  // Each edge shifted to the left, which is inside for a counter-clockwise ring.
  const shifted = ring.map((a, i): [Vec2, Vec2] => {
    const b = ring[(i + 1) % n] ?? a;
    const d = sub(b, a);
    const l = Math.hypot(d.x, d.y) || 1;
    const inward = { x: -d.y / l, y: d.x / l };
    const under = () =>
      walls.find((w) => lineDistance(a, w.a, w.b) < 1e-6 && lineDistance(b, w.a, w.b) < 1e-6);
    const k = onOutline(a, b) ? exteriorThickness : thicknessOf(under() ?? {}) / 2;
    return [add(a, scale(inward, k)), add(b, scale(inward, k))];
  });
  // Each corner is where the edge before it meets the edge after it.
  return ring.map((_, i) => {
    const prev = shifted[(i - 1 + n) % n];
    const next = shifted[i];
    if (!prev || !next) return ring[i] ?? { x: 0, y: 0 };
    return lineIntersection(prev[0], prev[1], next[0], next[1]) ?? next[0];
  });
}

/**
 * The clear part of an interior wall, as metres from its start: from the face of the wall
 * it meets at one end to the face of the wall at the other. Interior walls are stored
 * running to the building's outer face or another wall's centre line, so a length measured
 * end to end runs into the wall it meets. An end on the footprint loses the exterior wall's
 * thickness, an end on another interior wall half that wall, both measured along this
 * wall, so a wall meeting another at an angle stops on its face too.
 */
export function clearWallRange(
  wall: { a: Vec2; b: Vec2 },
  footprint: readonly Vec2[],
  others: readonly InteriorWall[],
  exteriorThickness: number,
  thicknessOf: ThicknessOf,
): [number, number] {
  const d = sub(wall.b, wall.a);
  const length = Math.hypot(d.x, d.y);
  if (length === 0) return [0, 0];
  const dir = scale(d, 1 / length);
  const outline = footprint.map((f, i) => ({
    a: f,
    b: footprint[(i + 1) % footprint.length] ?? f,
  }));
  const trim = (p: Vec2): number => {
    const onto = <L extends Segment>(lines: readonly L[], depth: (line: L) => number) => {
      for (const l of lines) {
        const e = sub(l.b, l.a);
        const el = Math.hypot(e.x, e.y);
        if (el === 0 || lineDistance(p, l.a, l.b) > 1e-6) continue;
        const t = dot(sub(p, l.a), e) / (el * el);
        if (t < -1e-6 || t > 1 + 1e-6) continue;
        // How far along this wall the other wall's face lies: its depth over the sine of the angle.
        const sin = Math.abs(cross(dir, scale(e, 1 / el)));
        if (sin > 1e-6) return depth(l) / sin;
      }
      return null;
    };
    return onto(outline, () => exteriorThickness) ?? onto(others, (o) => thicknessOf(o) / 2) ?? 0;
  };
  const from = trim(wall.a);
  const to = length - trim(wall.b);
  return to > from ? [from, to] : [0, length];
}

export interface RoomMeasures {
  /** A point inside the room for its stamp. */
  stamp: Vec2;
  /** The room's axes: along its longest wall, turned to read left to right, and across. */
  u: Vec2;
  v: Vec2;
  /** Overall size along `u` and `v`, metres. */
  width: number;
  depth: number;
}

/** The size of a room measured along its own walls, so a turned room reads its true width. */
export function roomMeasures(polygon: readonly Vec2[]): RoomMeasures {
  let longest = { x: 1, y: 0 };
  let best = -1;
  for (let i = 0; i < polygon.length; i++) {
    const a = polygon[i];
    const b = polygon[(i + 1) % polygon.length];
    if (!a || !b) continue;
    const l = distance(a, b);
    if (l > best) {
      best = l;
      longest = scale(sub(b, a), 1 / l);
    }
  }
  // The more horizontal of the wall and its perpendicular is `u`, pointing right.
  let u = Math.abs(longest.x) >= Math.abs(longest.y) ? longest : { x: -longest.y, y: longest.x };
  if (u.x < 0) u = scale(u, -1);
  const v = { x: -u.y, y: u.x };
  const extent = (axis: Vec2) => {
    const k = polygon.map((p) => dot(p, axis));
    return Math.max(...k) - Math.min(...k);
  };
  const c = centroid(polygon);
  let stamp = c;
  if (!pointInPolygon(c, polygon)) {
    // An L or U shaped room: the middle of the longest stretch of floor through the centroid.
    const through = longestInside(polygon, c, u) ?? longestInside(polygon, c, v);
    if (through) stamp = scale(add(through[0], through[1]), 0.5);
  }
  return { stamp, u, v, width: extent(u), depth: extent(v) };
}

/**
 * Where other walls meet `wall` on one side: the stretch along `wall` that each one's
 * thickness takes, metres from its start. `side` is the side the chain runs on (a unit
 * normal); a wall joining from that side, or crossing straight through, is on the chain's
 * line, a wall joining from the far side is not. The wall's own two ends are left out: where
 * it stops on another wall is the clear range's business (clearWallRange).
 */
export function wallJunctions(
  wall: { a: Vec2; b: Vec2 },
  side: Vec2,
  others: readonly InteriorWall[],
  thicknessOf: ThicknessOf,
): [number, number][] {
  const d = sub(wall.b, wall.a);
  const length = Math.hypot(d.x, d.y);
  if (length === 0) return [];
  const dir = scale(d, 1 / length);
  const EPS = 1e-6;
  const out: [number, number][] = [];
  for (const other of others) {
    const e = sub(other.b, other.a);
    const el = Math.hypot(e.x, e.y);
    const denom = cross(d, e);
    // Parallel walls do not meet across each other.
    if (el === 0 || Math.abs(denom) < EPS * length * el) continue;
    const ao = sub(other.a, wall.a);
    const t = cross(ao, e) / denom;
    const s = cross(ao, d) / denom;
    const u = t * length;
    const sOnOther = s * el;
    // Outside either wall, or at this wall's own ends.
    if (u <= EPS || u >= length - EPS || sOnOther < -EPS || sOnOther > el + EPS) continue;
    const atOtherStart = Math.abs(sOnOther) <= EPS;
    const atOtherEnd = Math.abs(sOnOther - el) <= EPS;
    if (atOtherStart || atOtherEnd) {
      // A T: the other wall runs off to one side only; it counts on that side.
      const far = atOtherStart ? other.b : other.a;
      const meet = add(wall.a, scale(dir, u));
      if (dot(sub(far, meet), side) <= 0) continue;
    }
    // Its thickness along this wall: half each way, over the sine of the angle between them.
    const sin = Math.max(Math.abs(cross(dir, scale(e, 1 / el))), 0.1);
    const half = thicknessOf(other) / 2 / sin;
    out.push([u - half, u + half]);
  }
  return out.sort((x, y) => x[0] - y[0]);
}

/**
 * The chain of dimensions along a wall, as German plans draw the inner chains: its openings,
 * the walls that meet it (`breaks`, from wallJunctions) with their thickness, and the clear
 * stretches between them, each measured on the outer face. Empty when there is neither an
 * opening nor a wall meeting it: the wall's length then says it all. A break that would cut
 * into an opening is left out; the opening wins.
 */
export function openingChain(
  wall: Wall,
  openings: readonly Opening[],
  offset: number,
  style: DimensionStyle = DEFAULT_DIMENSION_STYLE,
  /** The part of the wall measured, metres along it: all of it, or its clear part. */
  range: [number, number] = [0, wall.length],
  breaks: readonly [number, number][] = [],
): Dimension[] {
  const [from, to] = range;
  const clamp = (u: number) => Math.min(Math.max(u, from), to);
  const spans = openingSpans(wall, openings).map(([u0, u1]) => ({
    u0: clamp(u0),
    u1: clamp(u1),
    opening: openings.find((o) => Math.abs(o.offset - u0) < 1e-9),
  }));
  const walls = breaks
    .map(([u0, u1]) => ({ u0: clamp(u0), u1: clamp(u1), opening: undefined }))
    .filter(
      (b) =>
        b.u1 - b.u0 > 1e-6 &&
        b.u0 > from + 1e-6 &&
        b.u1 < to - 1e-6 &&
        !spans.some((o) => b.u0 < o.u1 - 1e-6 && o.u0 < b.u1 - 1e-6),
    );
  const pieces = [...spans, ...walls].sort((a, b) => a.u0 - b.u0);
  if (pieces.length === 0) return [];
  const at = (u: number) => add(wall.outerA, scale(wall.direction, u));
  const chain: Dimension[] = [];
  const push = (u0: number, u1: number, opening?: Opening) => {
    // Openings flush with a corner leave a zero piece; there is nothing to measure there.
    if (u1 - u0 <= 1e-6) return;
    const piece = dimension(at(u0), at(u1), wall.normal, offset, style);
    chain.push(opening ? { ...piece, opening } : piece);
  };
  let cursor = from;
  for (const p of pieces) {
    push(cursor, p.u0);
    push(p.u0, p.u1, p.opening);
    cursor = Math.max(cursor, p.u1);
  }
  push(cursor, to);
  return chain;
}
