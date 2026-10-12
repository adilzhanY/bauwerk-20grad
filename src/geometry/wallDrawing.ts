/**
 * Drawing an interior wall by hand. A wall is never free standing: it starts on a wall and
 * runs to the next wall it meets, so both its ends always sit on another wall.
 *
 * Where walls are stored is not where they are seen. An interior wall ends on the building's
 * outline (the outer face of the exterior wall) or on the centre line of another interior
 * wall, because rooms are the faces those lines close. What the user sees and aims at is the
 * face of the wall on their side: the inner face of an exterior wall, a face of an interior
 * wall. So a snap carries both: `point`, stored, and `shown`, where the dot is drawn.
 */
import { clearWallRange } from "./plan";
import { add, cross, dot, normalize, outlineEdges, scale, sub } from "./polygon";
import type { InteriorWall, Opening, Segment, ThicknessOf, Vec2 } from "./types";

/** The wall a point lies on: an edge of the outline, or an interior wall, by index. */
export type WallTarget = { kind: "outline"; index: number } | { kind: "wall"; index: number };

export interface WallSnap {
  /** The stored point: on the outline, or on an interior wall's centre line. */
  point: Vec2;
  /** Where it is seen: on the face of that wall towards the pointer. */
  shown: Vec2;
  target: WallTarget;
  /** Unit direction of the wall it lies on. */
  along: Vec2;
  /** On a window or door: no wall may meet another there. */
  blocked?: boolean;
}

export interface WallDraft {
  segment: Segment;
  end: WallSnap;
  /** The wall as seen: between the faces of the walls it meets. */
  clear: [Vec2, Vec2];
  /** Its clear length, metres. */
  length: number;
  /** It would end on a window or door: shown, but it cannot be placed. */
  blocked?: boolean;
}

export interface WallContext {
  /** The building outline, counter-clockwise. */
  footprint: readonly Vec2[];
  /** The storey's interior walls. */
  walls: readonly InteriorWall[];
  exteriorThickness: number;
  /** Each interior wall's thickness; a new wall has no type yet, so the default one. */
  thicknessOf: ThicknessOf;
  /** The storey's openings: no wall may start or end on one. */
  openings?: readonly Opening[];
}

/** Shorter than this between the wall faces is not a wall. */
export const MIN_CLEAR_LENGTH = 0.2;
/** A direction this close to a right angle (or to the building's axes) becomes exact. */
export const ANGLE_SNAP_DEG = 4;
/** A wall along the wall it starts from is no wall. */
const MIN_ANGLE_TO_START_DEG = 10;

const cm = (v: number) => Math.round(v * 100) / 100;

/**
 * Whether a wall meeting `target` at `u` metres along it would land on a window or door.
 * The meeting wall is a new one, of the default type: it must clear the opening by half its width.
 * Exterior openings are measured from the corner the outline edge starts at, interior ones
 * from the interior wall's first end, which is the same `u`.
 */
function onOpening(target: WallTarget, u: number, ctx: WallContext): boolean {
  const half = ctx.thicknessOf({}) / 2;
  const interior = target.kind === "wall";
  return (ctx.openings ?? []).some(
    (o) =>
      (o.interior ?? false) === interior &&
      o.wallIndex === target.index &&
      u > o.offset - half + 1e-9 &&
      u < o.offset + o.width + half - 1e-9,
  );
}

/**
 * The wall point under the pointer: the nearest wall whose face is within `radius` metres,
 * slid along it to the centimetre. Null when the pointer is on no wall.
 */
export function snapToWall(cursor: Vec2, ctx: WallContext, radius: number): WallSnap | null {
  // Every wall the pointer is on, with how far it is from that wall's face; the nearest wins.
  const found: { snap: WallSnap; miss: number }[] = [];
  const consider = (snap: WallSnap, miss: number) => {
    found.push({ snap, miss });
  };

  outlineEdges(ctx.footprint).forEach((edge, index) => {
    const d = sub(edge.b, edge.a);
    const length = Math.hypot(d.x, d.y);
    if (length === 0) return;
    const along = scale(d, 1 / length);
    // Inside a counter-clockwise outline is to the left of each edge.
    const inward = { x: -along.y, y: along.x };
    const t = dot(sub(cursor, edge.a), along);
    const depth = dot(sub(cursor, edge.a), inward);
    const t0 = ctx.exteriorThickness;
    // On the wall band, from a little outside it to a little inside its inner face, and within
    // its clear stretch between the corners.
    if (depth < -radius || depth > ctx.exteriorThickness + radius) return;
    if (t < t0 - radius || t > length - t0 + radius) return;
    const u = Math.min(Math.max(cm(t), t0), length - t0);
    const point = add(edge.a, scale(along, u));
    const target = { kind: "outline", index } as const;
    consider(
      {
        point,
        shown: add(point, scale(inward, ctx.exteriorThickness)),
        target,
        along,
        blocked: onOpening(target, u, ctx),
      },
      Math.abs(depth - ctx.exteriorThickness),
    );
  });

  ctx.walls.forEach((wall, index) => {
    const d = sub(wall.b, wall.a);
    const length = Math.hypot(d.x, d.y);
    if (length === 0) return;
    const along = scale(d, 1 / length);
    const normal = { x: -along.y, y: along.x };
    const t = dot(sub(cursor, wall.a), along);
    const offset = dot(sub(cursor, wall.a), normal);
    const half = ctx.thicknessOf(wall) / 2;
    if (Math.abs(offset) > half + radius || t < -radius || t > length + radius) return;
    const u = Math.min(Math.max(cm(t), 0), length);
    const point = add(wall.a, scale(along, u));
    const side = offset >= 0 ? 1 : -1;
    const target = { kind: "wall", index } as const;
    consider(
      {
        point,
        shown: add(point, scale(normal, side * half)),
        target,
        along,
        blocked: onOpening(target, u, ctx),
      },
      Math.max(0, Math.abs(offset) - half),
    );
  });

  found.sort((a, b) => a.miss - b.miss);
  return found[0]?.snap ?? null;
}

/**
 * The building's two main directions, both ways: along its longest outline edge and square
 * to it. Lines drawn near one of them lock onto it.
 */
export function buildingAxes(footprint: readonly Vec2[]): Vec2[] {
  let axis = { x: 1, y: 0 };
  let longest = 0;
  for (const e of outlineEdges(footprint)) {
    const d = sub(e.b, e.a);
    const l = Math.hypot(d.x, d.y);
    if (l > longest) {
      longest = l;
      axis = scale(d, 1 / l);
    }
  }
  const perp = { x: -axis.y, y: axis.x };
  return [axis, scale(axis, -1), perp, scale(perp, -1)];
}

/** The directions a new wall locks onto: square to the wall it starts from, and the building's axes. */
function lockDirections(start: WallSnap, footprint: readonly Vec2[]): Vec2[] {
  const square = { x: -start.along.y, y: start.along.x };
  return [square, scale(square, -1), ...buildingAxes(footprint)];
}

/**
 * The wall from `start` towards the pointer: it runs in that direction, locked to a right
 * angle when close to one, until the first wall it meets. Null when there is no such wall:
 * the pointer on the start, a direction out of the building or along the start wall, or a
 * wall too short between the faces.
 */
export function drawWallTo(start: WallSnap, cursor: Vec2, ctx: WallContext): WallDraft | null {
  if (start.blocked) return null;
  const towards = sub(cursor, start.point);
  if (Math.hypot(towards.x, towards.y) < 1e-6) return null;
  let dir = normalize(towards);
  const lock = Math.cos((ANGLE_SNAP_DEG * Math.PI) / 180);
  for (const candidate of lockDirections(start, ctx.footprint)) {
    if (dot(dir, candidate) >= lock) {
      dir = candidate;
      break;
    }
  }
  // Not along the wall it starts from.
  if (Math.abs(cross(dir, start.along)) < Math.sin((MIN_ANGLE_TO_START_DEG * Math.PI) / 180))
    return null;
  // From the outline only into the building.
  if (start.target.kind === "outline" && cross(start.along, dir) <= 0) return null;

  // The first wall the ray from the start meets.
  const targets: { target: WallTarget; segment: Segment }[] = [
    ...outlineEdges(ctx.footprint).map((segment, index) => ({
      target: { kind: "outline", index } as const,
      segment,
    })),
    ...ctx.walls.map((segment, index) => ({ target: { kind: "wall", index } as const, segment })),
  ];
  let hit: { t: number; target: WallTarget; segment: Segment } | null = null;
  for (const { target, segment } of targets) {
    if (target.kind === start.target.kind && target.index === start.target.index) continue;
    const e = sub(segment.b, segment.a);
    const denom = cross(dir, e);
    if (Math.abs(denom) < 1e-12) continue;
    const ap = sub(segment.a, start.point);
    const t = cross(ap, e) / denom;
    const s = cross(ap, dir) / denom;
    if (t <= 1e-6 || s < -1e-9 || s > 1 + 1e-9) continue;
    if (!hit || t < hit.t) hit = { t, target, segment };
  }
  if (!hit) return null;

  // Exactly on the wall it meets, so the rooms close.
  const e = sub(hit.segment.b, hit.segment.a);
  const el = Math.hypot(e.x, e.y);
  const along = scale(e, 1 / el);
  const s = Math.min(
    Math.max(dot(sub(add(start.point, scale(dir, hit.t)), hit.segment.a), along), 0),
    el,
  );
  const point = add(hit.segment.a, scale(along, s));
  const segment = { a: start.point, b: point };

  const [from, to] = clearWallRange(
    segment,
    ctx.footprint,
    ctx.walls,
    ctx.exteriorThickness,
    ctx.thicknessOf,
  );
  const length = to - from;
  if (length < MIN_CLEAR_LENGTH) return null;
  const wallDir = normalize(sub(point, start.point));
  const clear: [Vec2, Vec2] = [
    add(start.point, scale(wallDir, from)),
    add(start.point, scale(wallDir, to)),
  ];
  const blocked = onOpening(hit.target, s, ctx);
  const end: WallSnap = { point, shown: clear[1], target: hit.target, along, blocked };
  return { segment, end, clear, length, blocked };
}
