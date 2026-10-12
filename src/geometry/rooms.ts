import {
  EPSILON,
  area,
  cross,
  distance,
  equals,
  interiorPoint,
  lineIntersection,
  outlineEdges,
  pointInPolygon,
  pointOnSegment,
  segmentsIntersect,
  signedArea,
  sub,
} from "./polygon";
import type { Room, Segment, Vec2 } from "./types";

const KEY_PRECISION = 1e6;
const key = (p: Vec2) => `${Math.round(p.x * KEY_PRECISION)}:${Math.round(p.y * KEY_PRECISION)}`;

/**
 * Cuts an interior wall down to the parts that lie inside the footprint. A wall
 * fully outside disappears, a wall crossing the boundary is trimmed.
 */
export function clipSegmentToPolygon(segment: Segment, polygon: readonly Vec2[]): Segment[] {
  const params = new Set<number>([0, 1]);
  const n = polygon.length;
  for (let i = 0; i < n; i++) {
    const a = polygon[i];
    const b = polygon[(i + 1) % n];
    if (!a || !b) continue;
    const t = paramOnSegment(segment, a, b);
    if (t !== null) params.add(t);
    for (const p of [a, b]) {
      if (pointOnSegment(p, segment.a, segment.b)) params.add(paramOf(segment, p));
    }
  }
  const sorted = [...params].sort((x, y) => x - y);
  const pieces: Segment[] = [];
  for (let i = 0; i + 1 < sorted.length; i++) {
    const t0 = sorted[i];
    const t1 = sorted[i + 1];
    if (t0 === undefined || t1 === undefined || t1 - t0 < 1e-9) continue;
    const a = lerp(segment, t0);
    const b = lerp(segment, t1);
    const mid = lerp(segment, (t0 + t1) / 2);
    if (pointInPolygon(mid, polygon)) pieces.push({ a, b });
  }
  return pieces;
}

const lerp = (s: Segment, t: number): Vec2 => ({
  x: s.a.x + (s.b.x - s.a.x) * t,
  y: s.a.y + (s.b.y - s.a.y) * t,
});

function paramOf(s: Segment, p: Vec2): number {
  const d = sub(s.b, s.a);
  const l2 = d.x * d.x + d.y * d.y;
  if (l2 < EPSILON) return 0;
  const t = ((p.x - s.a.x) * d.x + (p.y - s.a.y) * d.y) / l2;
  return Math.min(1, Math.max(0, t));
}

/** Parameter along s where the segment ab crosses it, or null when it does not. */
function paramOnSegment(s: Segment, a: Vec2, b: Vec2): number | null {
  const hit = lineIntersection(s.a, s.b, a, b);
  if (!hit) return null;
  if (!pointOnSegment(hit, s.a, s.b) || !pointOnSegment(hit, a, b)) return null;
  return paramOf(s, hit);
}

/**
 * Splits every segment at every point where another segment touches or crosses
 * it, so the result is a proper planar graph with no edge passing through a
 * vertex. Duplicate edges collapse.
 */
export function splitSegments(segments: readonly Segment[]): Segment[] {
  const result = new Map<string, Segment>();
  segments.forEach((s, i) => {
    if (equals(s.a, s.b)) return;
    const params = new Set<number>([0, 1]);
    segments.forEach((o, j) => {
      if (i === j) return;
      const t = paramOnSegment(s, o.a, o.b);
      if (t !== null) params.add(t);
      for (const p of [o.a, o.b]) {
        if (pointOnSegment(p, s.a, s.b)) params.add(paramOf(s, p));
      }
    });
    const sorted = [...params].sort((x, y) => x - y);
    for (let k = 0; k + 1 < sorted.length; k++) {
      const t0 = sorted[k];
      const t1 = sorted[k + 1];
      if (t0 === undefined || t1 === undefined || t1 - t0 < 1e-9) continue;
      const a = lerp(s, t0);
      const b = lerp(s, t1);
      if (equals(a, b, 1e-7)) continue;
      const ka = key(a);
      const kb = key(b);
      const id = ka < kb ? `${ka}|${kb}` : `${kb}|${ka}`;
      if (!result.has(id)) result.set(id, { a, b });
    }
  });
  return [...result.values()];
}

interface HalfEdge {
  from: string;
  to: string;
  angle: number;
  visited: boolean;
}

/**
 * Bounded faces of the planar graph formed by the footprint and the interior
 * walls. Each face is returned counter-clockwise with spikes (dangling walls)
 * and collinear points removed. Uses the classic half-edge walk: at every
 * vertex turn to the next edge clockwise from the one we arrived on, which
 * keeps the face on the left.
 */
export function extractFaces(
  footprint: readonly Vec2[],
  interiorWalls: readonly Segment[],
): Vec2[][] {
  const boundary = outlineEdges(footprint);
  const clipped = interiorWalls.flatMap((w) => clipSegmentToPolygon(w, footprint));
  return facesOfSegments([...boundary, ...clipped]);
}

/**
 * Bounded faces of the planar graph formed by any set of segments. Each face is
 * returned counter-clockwise with spikes (dangling segments) and collinear points
 * removed. Classic half-edge walk: at every vertex turn to the next edge clockwise
 * from the one we arrived on, which keeps the face on the left.
 */
export function facesOfSegments(segments: readonly Segment[]): Vec2[][] {
  const edges = splitSegments(segments);

  const points = new Map<string, Vec2>();
  const outgoing = new Map<string, HalfEdge[]>();
  const halfEdges: HalfEdge[] = [];
  const addHalf = (a: Vec2, b: Vec2) => {
    const ka = key(a);
    const kb = key(b);
    points.set(ka, a);
    points.set(kb, b);
    const he: HalfEdge = {
      from: ka,
      to: kb,
      angle: Math.atan2(b.y - a.y, b.x - a.x),
      visited: false,
    };
    halfEdges.push(he);
    const list = outgoing.get(ka) ?? [];
    list.push(he);
    outgoing.set(ka, list);
  };
  for (const e of edges) {
    addHalf(e.a, e.b);
    addHalf(e.b, e.a);
  }
  for (const list of outgoing.values()) list.sort((p, q) => p.angle - q.angle);

  const faces: Vec2[][] = [];
  const holes: Vec2[][] = [];
  for (const start of halfEdges) {
    if (start.visited) continue;
    const ring: Vec2[] = [];
    let current = start;
    let guard = 0;
    do {
      current.visited = true;
      const p = points.get(current.from);
      if (p) ring.push(p);
      const list = outgoing.get(current.to) ?? [];
      const reverseIndex = list.findIndex((h) => h.to === current.from);
      const next = list[(reverseIndex - 1 + list.length) % list.length];
      if (!next) break;
      current = next;
      guard += 1;
    } while (current !== start && guard < halfEdges.length + 1);
    const cleaned = cleanRing(ring);
    if (cleaned.length < 3) continue;
    const signed = signedArea(cleaned);
    if (signed > 1e-9) faces.push(cleaned);
    else if (signed < -1e-9) holes.push(cleaned);
  }
  // A loop of walls touching nothing else walks out as a clockwise ring: a hole in the face
  // around it. Joined to that face by a slit, so its floor is not counted twice.
  for (const hole of holes) {
    const first = hole[0];
    if (!first) continue;
    const around = faces
      .filter((f) => !f.some((p) => equals(p, first, 1e-7)) && pointInPolygon(first, f))
      .sort((p, q) => area(p) - area(q))[0];
    if (around) faces[faces.indexOf(around)] = withHole(around, hole, holes);
  }
  return faces;
}

/** The face with the hole cut in through the shortest slit that crosses no other edge. */
function withHole(face: Vec2[], hole: Vec2[], holes: readonly Vec2[][]): Vec2[] {
  const rings = [face, ...holes];
  const blocked = (f: Vec2, h: Vec2) =>
    rings.some((ring) =>
      ring.some((p, k) => {
        const q = ring[(k + 1) % ring.length] ?? p;
        if ([p, q].some((e) => equals(e, f) || equals(e, h))) return false;
        return segmentsIntersect(f, h, p, q);
      }),
    );
  let best: { i: number; j: number; d: number } | undefined;
  for (const [i, f] of face.entries()) {
    for (const [j, h] of hole.entries()) {
      const d = distance(f, h);
      if ((!best || d < best.d) && !blocked(f, h)) best = { i, j, d };
    }
  }
  if (!best) return face;
  const { i, j } = best;
  return [...face.slice(0, i + 1), ...hole.slice(j), ...hole.slice(0, j + 1), ...face.slice(i)];
}

/** Removes backtracking spikes and collinear middle points from a closed ring. */
export function cleanRing(ring: readonly Vec2[]): Vec2[] {
  let pts = [...ring];
  let changed = true;
  while (changed && pts.length >= 3) {
    changed = false;
    for (let i = 0; i < pts.length; i++) {
      const prev = pts[(i - 1 + pts.length) % pts.length];
      const curr = pts[i];
      const next = pts[(i + 1) % pts.length];
      if (!prev || !curr || !next) continue;
      const spike = equals(prev, next, 1e-7);
      const duplicate = equals(curr, next, 1e-7);
      const collinear = Math.abs(cross(sub(curr, prev), sub(next, curr))) < 1e-9;
      if (spike || duplicate || collinear) {
        pts = duplicate
          ? pts.filter((_, j) => j !== i)
          : spike
            ? pts.filter((_, j) => j !== i && j !== (i + 1) % pts.length)
            : pts.filter((_, j) => j !== i);
        changed = true;
        break;
      }
    }
  }
  return pts;
}

export interface RoomFactory {
  createId: () => string;
  defaultName: (index: number) => string;
}

/**
 * Recomputes the rooms of a storey from its interior walls and carries over the
 * user's names and zone assignments. A previous room survives in the new face
 * that contains a point inside its old outline (its centroid, unless the room is
 * concave and the centroid falls outside); when a room is split, the half holding
 * that point keeps the identity and the other half becomes a new room.
 */
export function computeRooms(
  footprint: readonly Vec2[],
  interiorWalls: readonly Segment[],
  previous: readonly Room[],
  factory: RoomFactory,
): Room[] {
  const faces = extractFaces(footprint, interiorWalls);
  const unused = [...previous].sort((a, b) => b.area - a.area);
  const rooms: Room[] = [];
  for (const polygon of faces) {
    const matchIndex = unused.findIndex(
      (r) => r.polygon.length > 0 && pointInPolygon(interiorPoint(r.polygon), polygon),
    );
    const match = matchIndex === -1 ? undefined : unused.splice(matchIndex, 1)[0];
    const room: Room = {
      id: match?.id ?? factory.createId(),
      name: match?.name ?? "",
      polygon,
      area: roundArea(area(polygon)),
    };
    if (match?.zoneId !== undefined) room.zoneId = match.zoneId;
    rooms.push(room);
  }
  let nextIndex = 1;
  const taken = new Set(rooms.map((r) => r.name));
  for (const room of rooms) {
    if (room.name !== "") continue;
    let name = factory.defaultName(nextIndex);
    while (taken.has(name)) {
      nextIndex += 1;
      name = factory.defaultName(nextIndex);
    }
    room.name = name;
    taken.add(name);
    nextIndex += 1;
  }
  return rooms;
}

const roundArea = (a: number) => Math.round(a * 1e6) / 1e6;
