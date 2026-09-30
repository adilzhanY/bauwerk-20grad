import type { Segment, Vec2 } from "./types";

export const EPSILON = 1e-9;

export interface Edge {
  /** Index of the edge. Runs from vertex `index` to vertex `index + 1`. */
  index: number;
  a: Vec2;
  b: Vec2;
  length: number;
  /** Unit vector from a to b. */
  direction: Vec2;
  /** Unit vector pointing out of the polygon (valid for counter-clockwise polygons). */
  normal: Vec2;
}

export const vec = (x: number, y: number): Vec2 => ({ x, y });
export const add = (a: Vec2, b: Vec2): Vec2 => ({ x: a.x + b.x, y: a.y + b.y });
export const sub = (a: Vec2, b: Vec2): Vec2 => ({ x: a.x - b.x, y: a.y - b.y });
export const scale = (a: Vec2, s: number): Vec2 => ({ x: a.x * s, y: a.y * s });
export const dot = (a: Vec2, b: Vec2): number => a.x * b.x + a.y * b.y;
export const cross = (a: Vec2, b: Vec2): number => a.x * b.y - a.y * b.x;
export const length = (a: Vec2): number => Math.hypot(a.x, a.y);
export const distance = (a: Vec2, b: Vec2): number => length(sub(a, b));
export const equals = (a: Vec2, b: Vec2, eps = EPSILON): boolean =>
  Math.abs(a.x - b.x) <= eps && Math.abs(a.y - b.y) <= eps;

export function normalize(a: Vec2): Vec2 {
  const l = length(a);
  return l < EPSILON ? { x: 0, y: 0 } : { x: a.x / l, y: a.y / l };
}

/** Shoelace formula. Positive for counter-clockwise polygons in a Y-up plane. */
export function signedArea(polygon: readonly Vec2[]): number {
  let sum = 0;
  for (let i = 0; i < polygon.length; i++) {
    const p = polygon[i];
    const q = polygon[(i + 1) % polygon.length];
    if (!p || !q) continue;
    sum += cross(p, q);
  }
  return sum / 2;
}

export const area = (polygon: readonly Vec2[]): number => Math.abs(signedArea(polygon));

export const isCounterClockwise = (polygon: readonly Vec2[]): boolean => signedArea(polygon) > 0;

/** Returns the same vertices, reversed if needed, so the polygon runs counter-clockwise. */
export function ensureCounterClockwise(polygon: readonly Vec2[]): Vec2[] {
  return isCounterClockwise(polygon) ? [...polygon] : [...polygon].reverse();
}

/** Orientation of c relative to the directed line a to b. Positive is left. */
export const orient = (a: Vec2, b: Vec2, c: Vec2): number => cross(sub(b, a), sub(c, a));

function onSegment(a: Vec2, b: Vec2, p: Vec2): boolean {
  return (
    Math.min(a.x, b.x) - EPSILON <= p.x &&
    p.x <= Math.max(a.x, b.x) + EPSILON &&
    Math.min(a.y, b.y) - EPSILON <= p.y &&
    p.y <= Math.max(a.y, b.y) + EPSILON
  );
}

/** True when segments ab and cd share at least one point, including touching endpoints. */
export function segmentsIntersect(a: Vec2, b: Vec2, c: Vec2, d: Vec2): boolean {
  const d1 = orient(c, d, a);
  const d2 = orient(c, d, b);
  const d3 = orient(a, b, c);
  const d4 = orient(a, b, d);
  if (
    ((d1 > EPSILON && d2 < -EPSILON) || (d1 < -EPSILON && d2 > EPSILON)) &&
    ((d3 > EPSILON && d4 < -EPSILON) || (d3 < -EPSILON && d4 > EPSILON))
  ) {
    return true;
  }
  if (Math.abs(d1) <= EPSILON && onSegment(c, d, a)) return true;
  if (Math.abs(d2) <= EPSILON && onSegment(c, d, b)) return true;
  if (Math.abs(d3) <= EPSILON && onSegment(a, b, c)) return true;
  if (Math.abs(d4) <= EPSILON && onSegment(a, b, d)) return true;
  return false;
}

/**
 * Intersection point of the infinite lines through ab and cd, or null when parallel.
 */
export function lineIntersection(a: Vec2, b: Vec2, c: Vec2, d: Vec2): Vec2 | null {
  const r = sub(b, a);
  const s = sub(d, c);
  const denominator = cross(r, s);
  if (Math.abs(denominator) < EPSILON) return null;
  const t = cross(sub(c, a), s) / denominator;
  return add(a, scale(r, t));
}

/**
 * A simple polygon has at least 3 vertices, no repeated vertices, no zero-length
 * edges and no two non-adjacent edges that touch or cross.
 */
export function isSimplePolygon(polygon: readonly Vec2[]): boolean {
  const n = polygon.length;
  if (n < 3) return false;
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const p = polygon[i];
      const q = polygon[j];
      if (p && q && equals(p, q)) return false;
    }
  }
  if (Math.abs(signedArea(polygon)) < EPSILON) return false;
  for (let i = 0; i < n; i++) {
    const a = polygon[i];
    const b = polygon[(i + 1) % n];
    if (!a || !b) return false;
    for (let j = i + 1; j < n; j++) {
      const adjacent = j === i + 1 || (i === 0 && j === n - 1);
      if (adjacent) continue;
      const c = polygon[j];
      const d = polygon[(j + 1) % n];
      if (!c || !d) return false;
      if (segmentsIntersect(a, b, c, d)) return false;
    }
  }
  // Collinear consecutive edges folding back on themselves are caught above;
  // collinear edges continuing straight are allowed.
  return true;
}

/** Ray casting. Points on the boundary count as inside. */
export function pointInPolygon(point: Vec2, polygon: readonly Vec2[]): boolean {
  const n = polygon.length;
  let inside = false;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const a = polygon[i];
    const b = polygon[j];
    if (!a || !b) continue;
    if (pointOnSegment(point, a, b)) return true;
    const crossesY = a.y > point.y !== b.y > point.y;
    if (crossesY) {
      const x = ((b.x - a.x) * (point.y - a.y)) / (b.y - a.y) + a.x;
      if (point.x < x) inside = !inside;
    }
  }
  return inside;
}

export function pointOnSegment(p: Vec2, a: Vec2, b: Vec2, eps = 1e-7): boolean {
  if (Math.abs(orient(a, b, p)) > eps) return false;
  return onSegment(a, b, p);
}

/** Edge list of a counter-clockwise polygon with lengths and outward normals. */
export function edges(polygon: readonly Vec2[]): Edge[] {
  const result: Edge[] = [];
  const n = polygon.length;
  for (let i = 0; i < n; i++) {
    const a = polygon[i];
    const b = polygon[(i + 1) % n];
    if (!a || !b) continue;
    const d = sub(b, a);
    const len = length(d);
    const direction = normalize(d);
    // For a counter-clockwise polygon the interior is on the left of each edge,
    // so the outward normal is the direction rotated clockwise by 90 degrees.
    const normal = { x: direction.y + 0, y: -direction.x + 0 };
    result.push({ index: i, a, b, length: len, direction, normal });
  }
  return result;
}

export const toSegments = (polygon: readonly Vec2[]): Segment[] =>
  edges(polygon).map((e) => ({ a: e.a, b: e.b }));

export function centroid(polygon: readonly Vec2[]): Vec2 {
  const a = signedArea(polygon);
  if (Math.abs(a) < EPSILON) {
    const n = polygon.length || 1;
    return scale(
      polygon.reduce((acc, p) => add(acc, p), vec(0, 0)),
      1 / n,
    );
  }
  let cx = 0;
  let cy = 0;
  for (let i = 0; i < polygon.length; i++) {
    const p = polygon[i];
    const q = polygon[(i + 1) % polygon.length];
    if (!p || !q) continue;
    const f = cross(p, q);
    cx += (p.x + q.x) * f;
    cy += (p.y + q.y) * f;
  }
  return { x: cx / (6 * a), y: cy / (6 * a) };
}

export function bounds(polygon: readonly Vec2[]): { min: Vec2; max: Vec2 } {
  const min = vec(Infinity, Infinity);
  const max = vec(-Infinity, -Infinity);
  for (const p of polygon) {
    min.x = Math.min(min.x, p.x);
    min.y = Math.min(min.y, p.y);
    max.x = Math.max(max.x, p.x);
    max.y = Math.max(max.y, p.y);
  }
  return { min, max };
}

export const snapToGrid = (value: number, grid: number): number => Math.round(value / grid) * grid;

export const snapPoint = (p: Vec2, grid: number): Vec2 => ({
  x: snapToGrid(p.x, grid),
  y: snapToGrid(p.y, grid),
});
