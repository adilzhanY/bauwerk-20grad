/**
 * Interior walls as the pieces people see and work with: a wall runs from one joint to the
 * next. Where another wall joins a wall or crosses it, the wall is two walls; where two walls
 * meet in a straight line and nothing else joins there, they are one. So a click picks the
 * wall between two rooms, deleting it joins exactly those two rooms, and moving it moves only
 * it. This is also how a building's walls are counted for its energy: each piece of wall
 * separates two rooms (or a room and the outside).
 *
 * Doors move with the pieces: split, a door stays at its place on the piece it lies on;
 * joined, it keeps its place on the joined wall. Each piece keeps its wall's type, and two
 * walls of different types stay two walls.
 */
import { add, cross, distance, dot, normalize, scale, sub } from "./polygon";
import type { InteriorWall, Opening, Segment, ThicknessOf, Vec2 } from "./types";

const EPS = 1e-6;

export interface WallSet {
  walls: InteriorWall[];
  /** All the storey's openings; only interior ones are touched. */
  openings: Opening[];
}

const lengthOf = (s: Segment) => distance(s.a, s.b);
const dirOf = (s: Segment) => normalize(sub(s.b, s.a));

/** Metres along `s` from its start to the foot of `p`, and how far `p` is off its line. */
function place(p: Vec2, s: Segment): { u: number; off: number } {
  const d = dirOf(s);
  const r = sub(p, s.a);
  return { u: dot(r, d), off: Math.abs(cross(d, r)) };
}

/** Whether `p` lies on segment `s`, ends included. */
export function onSegment(p: Vec2, s: Segment): boolean {
  const { u, off } = place(p, s);
  return off < EPS && u > -EPS && u < lengthOf(s) + EPS;
}

const collinear = (s: Segment, t: Segment) =>
  Math.abs(cross(dirOf(s), dirOf(t))) < 1e-9 && place(t.a, s).off < EPS;

/** Where the lines of `s` and `t` cross, or null when they are parallel. */
function lineMeet(s: Segment, t: Segment): Vec2 | null {
  const r = sub(s.b, s.a);
  const q = sub(t.b, t.a);
  const denom = cross(r, q);
  if (Math.abs(denom) < 1e-12) return null;
  return add(s.a, scale(r, cross(sub(t.a, s.a), q) / denom));
}

/** Splits every wall where another wall joins it or crosses it. */
function split(set: WallSet): WallSet {
  const walls = set.walls.map((w) => ({ ...w }));
  let openings = set.openings.map((o) => ({ ...o }));
  // Each wall's cut points, metres along it.
  for (let i = 0; i < walls.length; i++) {
    const w = walls[i];
    if (!w) continue;
    const length = lengthOf(w);
    const cuts = new Set<number>();
    for (let j = 0; j < walls.length; j++) {
      const o = walls[j];
      if (!o || j === i) continue;
      for (const p of [o.a, o.b]) {
        const { u, off } = place(p, w);
        if (off < EPS && u > EPS && u < length - EPS) cuts.add(u);
      }
      const meet = lineMeet(w, o);
      if (meet && onSegment(meet, o)) {
        const { u } = place(meet, w);
        if (u > EPS && u < length - EPS) cuts.add(u);
      }
    }
    if (cuts.size === 0) continue;
    const us = [...cuts].sort((x, y) => x - y);
    const d = dirOf(w);
    const at = (u: number) => add(w.a, scale(d, u));
    const stops = [0, ...us, length];
    // The first piece keeps the wall's place in the list; the rest go to the end.
    const indices = [i];
    walls[i] = { ...w, a: w.a, b: at(stops[1] ?? length) };
    for (let k = 1; k + 1 < stops.length; k++) {
      indices.push(walls.length);
      walls.push({ ...w, a: at(stops[k] ?? 0), b: at(stops[k + 1] ?? length) });
    }
    openings = openings.map((o) => {
      if (!o.interior || o.wallIndex !== i) return o;
      // The piece the door's middle is on.
      const mid = o.offset + o.width / 2;
      const k = Math.max(
        0,
        stops.findIndex((s, n) => mid >= s - EPS && mid <= (stops[n + 1] ?? s) + EPS),
      );
      // A door cannot span a joint: one that reached past it (a plan read slightly off) slides
      // back onto its piece, and shrinks only if the piece is shorter than the door.
      const from = stops[k] ?? 0;
      const piece = (stops[k + 1] ?? length) - from;
      const width = Math.min(o.width, piece);
      const offset = Math.min(Math.max(o.offset - from, 0), piece - width);
      return { ...o, wallIndex: indices[k] ?? i, offset, width };
    });
  }
  return { walls, openings };
}

/** Joins two walls of one type that meet in a straight line where nothing else joins. */
function join(set: WallSet): WallSet {
  let { walls, openings } = set;
  for (;;) {
    let merged = false;
    outer: for (let i = 0; i < walls.length; i++) {
      for (let j = i + 1; j < walls.length; j++) {
        const s = walls[i];
        const t = walls[j];
        if (!s || !t || !collinear(s, t) || s.constructionId !== t.constructionId) continue;
        // The shared end, and the two far ends.
        const pairs: [Vec2, Vec2, Vec2][] = [
          [s.a, s.b, t.a],
          [s.a, s.b, t.b],
          [s.b, s.a, t.a],
          [s.b, s.a, t.b],
        ];
        for (const [shared, sFar, tEnd] of pairs) {
          if (distance(shared, tEnd) > EPS) continue;
          const tFar = distance(tEnd, t.a) < EPS ? t.b : t.a;
          // Nothing else at the joint: no other wall ends on it or runs through it.
          const alone = walls.every((w, k) => k === i || k === j || !onSegment(shared, w));
          if (!alone) continue;
          const joined: InteriorWall = { ...s, a: sFar, b: tFar };
          const jd = dirOf(joined);
          const moveTo = (o: Opening, host: Segment): Opening => {
            const start = add(host.a, scale(dirOf(host), o.offset));
            const end = add(host.a, scale(dirOf(host), o.offset + o.width));
            const u = Math.min(dot(sub(start, joined.a), jd), dot(sub(end, joined.a), jd));
            return { ...o, wallIndex: i, offset: u };
          };
          openings = openings.map((o) => {
            if (!o.interior) return o;
            if (o.wallIndex === i) return moveTo(o, s);
            if (o.wallIndex === j) return moveTo(o, t);
            if (o.wallIndex > j) return { ...o, wallIndex: o.wallIndex - 1 };
            return o;
          });
          walls = walls.map((w, k) => (k === i ? joined : w)).filter((_, k) => k !== j);
          merged = true;
          break outer;
        }
      }
    }
    if (!merged) return { walls, openings };
  }
}

/**
 * The walls as pieces from joint to joint: split where walls join or cross, joined where two
 * meet straight with nothing else there. Doing it twice changes nothing.
 */
export function normalizeWalls(set: WallSet): WallSet {
  return join(split(set));
}

// Moving a wall --------------------------------------------------------------------------

export interface MoveContext {
  footprint: readonly Vec2[];
  exteriorThickness: number;
  /** Each interior wall's thickness, from its type. */
  thicknessOf: ThicknessOf;
}

export interface WallMove extends WallSet {
  /** Where the moved wall is now in the list. */
  index: number;
}

/** Shorter than this, a wall between its joints is not worth keeping: the move is refused. */
const MIN_PIECE = 0.05;

const outlineEdges = (footprint: readonly Vec2[]): Segment[] =>
  footprint.map((a, i) => ({ a, b: footprint[(i + 1) % footprint.length] ?? a }));

/**
 * Moves interior wall `index` sideways by `delta` metres (along its left normal). Its ends
 * slide along the walls they meet; a wall that ended where it met them grows or shrinks to
 * stay on it. Null when the move cannot keep every wall joined: an end off the building's
 * outline or into a door or window, the wall passing over another wall, or a wall too short.
 */
export function moveWall(
  index: number,
  delta: number,
  set: WallSet,
  ctx: MoveContext,
): WallMove | null {
  const wall = set.walls[index];
  if (!wall || Math.abs(delta) < EPS) return wall ? { ...set, index } : null;
  const d = dirOf(wall);
  const n = { x: -d.y, y: d.x };
  const shift = scale(n, delta);
  const moved: Segment = { a: add(wall.a, shift), b: add(wall.b, shift) };
  const walls = set.walls.map((w) => ({ ...w }));
  const edges = outlineEdges(ctx.footprint);

  const newEnds: Vec2[] = [];
  // Every wall the move changes: the moved one and cross walls that grow or shorten with it.
  const changed = new Set<number>([index]);
  for (const end of [wall.a, wall.b] as const) {
    const others = walls
      .map((w, k) => ({ w, k }))
      .filter(({ k }) => k !== index)
      .filter(({ w }) => onSegment(end, w) && !collinear(w, wall));
    const edge = edges.find((e) => onSegment(end, e));
    const cross_ = edge ?? others[0]?.w;
    if (!cross_) return null;
    const meet = lineMeet(moved, cross_);
    if (!meet) return null;

    if (edge) {
      // On the outline: within the clear stretch of that exterior wall.
      const { u } = place(meet, edge);
      const len = lengthOf(edge);
      if (u < ctx.exteriorThickness - EPS || u > len - ctx.exteriorThickness + EPS) return null;
      newEnds.push(meet);
      continue;
    }

    // Walls that join the end and are not the cross wall stay at the old joint.
    const stays = walls.some(
      (w, k) => k !== index && !others.some((o) => o.k === k) && onSegment(end, w),
    );
    // A cross wall that ends at the joint follows the wall when nothing else holds it there.
    const ending = others.find(({ w }) => distance(w.a, end) < EPS || distance(w.b, end) < EPS);
    const onALine = walls.some((w, k) => k !== index && collinear(w, cross_) && onSegment(meet, w));
    if (ending && !stays && others.length === 1) {
      const w = ending.w;
      walls[ending.k] = distance(w.a, end) < EPS ? { ...w, a: meet } : { ...w, b: meet };
      changed.add(ending.k);
    } else if (!onALine) {
      if (!ending) return null;
      // Beyond the cross wall's end: it grows to reach the moved wall, the old joint on it.
      const w = ending.w;
      const grown = distance(w.a, end) < EPS ? { ...w, a: meet } : { ...w, b: meet };
      if (!onSegment(end, grown)) return null;
      walls[ending.k] = grown;
      changed.add(ending.k);
    }
    newEnds.push(meet);
  }
  const [na, nb] = newEnds;
  if (!na || !nb) return null;
  walls[index] = { ...wall, a: na, b: nb };

  // Not over another wall on the way: no changed wall may cross or overlap another wall
  // anywhere but at a joint, where one of the two ends on the other.
  for (const c of changed) {
    const w = walls[c];
    if (!w) return null;
    for (let k = 0; k < walls.length; k++) {
      const o = walls[k];
      if (!o || k === c) continue;
      if (collinear(w, o)) {
        const { u: u0 } = place(o.a, w);
        const { u: u1 } = place(o.b, w);
        const overlap = Math.min(lengthOf(w), Math.max(u0, u1)) - Math.max(0, Math.min(u0, u1));
        if (overlap > EPS) return null;
        continue;
      }
      const meet = lineMeet(w, o);
      if (!meet || !onSegment(meet, w) || !onSegment(meet, o)) continue;
      const atEnd = [w.a, w.b, o.a, o.b].some((p) => distance(p, meet) < EPS);
      if (!atEnd) return null;
    }
  }

  // Doors keep their place on the walls that changed; one that no longer fits refuses the move.
  const openings: Opening[] = [];
  for (const o of set.openings) {
    if (!o.interior) {
      openings.push(o);
      continue;
    }
    const before = set.walls[o.wallIndex];
    const after = walls[o.wallIndex];
    if (!before || !after) return null;
    let offset = o.offset;
    if (o.wallIndex !== index) {
      // Kept where it was in the room: measured again from the wall's new start.
      const start = add(before.a, scale(dirOf(before), o.offset));
      offset = dot(sub(start, after.a), dirOf(after));
    }
    if (offset < -EPS || offset + o.width > lengthOf(after) + EPS) return null;
    openings.push(offset === o.offset ? o : { ...o, offset });
  }

  // No wall may end up too short, and no joint may land on a door or window.
  const result = normalizeWalls({ walls, openings });
  for (const w of result.walls) if (lengthOf(w) < MIN_PIECE) return null;
  const hits = (p: Vec2) =>
    result.openings.some((o) => {
      const host = o.interior ? result.walls[o.wallIndex] : edges[o.wallIndex];
      if (!host || !onSegment(p, host)) return false;
      const { u } = place(p, host);
      // The moved wall meets the host there, so it must clear the opening by half its own width.
      const half = ctx.thicknessOf(wall) / 2;
      return u > o.offset - half + EPS && u < o.offset + o.width + half - EPS;
    });
  if (newEnds.some(hits)) return null;

  // The moved wall's place in the list after the tidy up: the piece on its line.
  const found = result.walls.findIndex((w) => onSegment(add(na, scale(sub(nb, na), 0.5)), w));
  return { ...result, index: found === -1 ? index : found };
}

// Where a wall piece is seen ----------------------------------------------------------------

/**
 * Where interior wall `index` is drawn or measured, as metres along it from its start (the
 * range may reach past its ends at a corner). At each end:
 *
 * - On the building's outline: to the inner face of the exterior wall.
 * - Where the wall goes on straight (a piece of the same wall continues): right to the joint,
 *   so a wall split by a joining wall still looks like one.
 * - Where it joins a wall that runs through the joint (the stem of a T): to that wall's face.
 * - At a corner, where both walls end: half a wall past the joint, so the corner is filled.
 *
 * With `side` (the side a dimension chain runs on) it is measured as German inner chains do:
 * to the face of a wall meeting it on that side, straight on where none does, and to the
 * outer face of a corner otherwise.
 */
export function pieceRange(
  index: number,
  walls: readonly InteriorWall[],
  ctx: MoveContext,
  side?: Vec2,
): [number, number] {
  const w = walls[index];
  if (!w) return [0, 0];
  const length = lengthOf(w);
  const d = dirOf(w);
  const half = (o: InteriorWall) => ctx.thicknessOf(o) / 2;
  const edges = outlineEdges(ctx.footprint);
  const sinTo = (s: Segment) => Math.max(Math.abs(cross(d, dirOf(s))), 0.1);

  /** How far in from `p` the wall is seen; negative reaches past it. */
  const trim = (p: Vec2): number => {
    const edge = edges.find((e) => onSegment(p, e));
    if (edge) return ctx.exteriorThickness / sinTo(edge);
    const others = walls.filter((o, k) => k !== index && onSegment(p, o));
    if (others.length === 0) return 0;
    // A wall running through the point (not ending there): the stem of an unsplit T.
    const through = others.find(
      (o) => distance(o.a, p) > EPS && distance(o.b, p) > EPS && !collinear(o, w),
    );
    if (through) return half(through) / sinTo(through);
    const partner = others.some((o) => collinear(o, w));
    const across = others.filter((o) => !collinear(o, w));
    if (across.length === 0) return 0;
    // An across wall runs on past the joint when a piece of it continues on the other side.
    const runsOn = (o: InteriorWall) => others.some((x) => x !== o && collinear(x, o));
    const first = across[0];
    if (!first) return 0;
    if (side) {
      const far = (o: InteriorWall) => (distance(o.a, p) < EPS ? o.b : o.a);
      const onSide = across.find((o) => runsOn(o) || dot(sub(far(o), p), side) > EPS);
      if (onSide) return half(onSide) / sinTo(onSide);
      return partner ? 0 : -half(first) / sinTo(first);
    }
    if (partner) return 0;
    const running = across.find(runsOn);
    return running ? half(running) / sinTo(running) : -half(first) / sinTo(first);
  };
  return [trim(w.a), length - trim(w.b)];
}
