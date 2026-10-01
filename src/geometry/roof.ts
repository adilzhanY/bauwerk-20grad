import {
  area,
  bounds,
  centroid,
  edges,
  lineIntersection,
  add,
  scale,
  sub,
  cross,
  isCounterClockwise,
} from "./polygon";
import { cleanRing } from "./rooms";
import type { Building, Roof, Vec2 } from "./types";

/**
 * Roof shapes over the footprint. Faces are planar 3D polygons in metres with
 * plan (x, y) and height z; the scene triangulates them, the energy layer uses
 * their true area, IFC gets them as a surface model.
 *
 * Gable: the ridge runs through the footprint centre along the chosen axis;
 * every point rises by (distance to the outer eave - distance to the ridge) x
 * tan(pitch). This works for any footprint as a folded plate; for a rectangle
 * it is the classic two-plane gable.
 * Hip: only for rectangular footprints (four axis-aligned vertices), where the
 * straight skeleton is two trapezoids and two triangles. The ridge always runs
 * along the longer side, whatever the ridge axis setting says, since a ridge
 * along the short side would collapse the hip into a pyramid. Other footprints
 * fall back to a gable, documented in the roof summary.
 * Flat: the footprint at the top with a parapet band of the given height.
 * Attic volume under a gable or hip is the integral of a piecewise linear
 * height, which for each planar face is its plan area times the height at its
 * plan centroid.
 */

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

export interface RoofFace {
  points: Vec3[];
  /** Plan area of the face's projection. */
  planArea: number;
  /** True sloped area. */
  area: number;
}

export interface RoofGeometry {
  kind: Roof["kind"];
  /** The kind actually built; a hip on a non-rectangular footprint falls back to gable. */
  builtKind: Roof["kind"];
  faces: RoofFace[];
  /** The main ridge, for callers that want one line. */
  ridge: { a: Vec3; b: Vec3 } | null;
  /** Every ridge; a cross gable over an L shape has one per wing. */
  ridges: { a: Vec3; b: Vec3 }[];
  /** Outline of the roof at eave level, footprint plus overhang. */
  eaves: Vec2[];
  area: number;
  ridgeHeight: number;
  atticVolume: number;
}

export const DEFAULT_ROOF: Roof = {
  kind: "flat",
  pitch: 35,
  overhang: 0.3,
  ridgeAxis: "x",
  parapet: 0.3,
  heatedAttic: false,
};

export const roofOf = (building: Building): Roof => ({ ...DEFAULT_ROOF, ...building.roof });

const rad = (d: number) => (d * Math.PI) / 180;

/** Offsets a counter-clockwise polygon outward by `d` metres with mitred corners. */
export function offsetPolygon(polygon: readonly Vec2[], d: number): Vec2[] {
  if (Math.abs(d) < 1e-9) return [...polygon];
  const es = edges(polygon);
  const n = es.length;
  const lines = es.map(
    (e) => [add(e.a, scale(e.normal, d)), add(e.b, scale(e.normal, d))] as const,
  );
  const out: Vec2[] = [];
  for (let i = 0; i < n; i++) {
    const prev = lines[(i + n - 1) % n];
    const curr = lines[i];
    if (!prev || !curr) continue;
    out.push(lineIntersection(prev[0], prev[1], curr[0], curr[1]) ?? curr[0]);
  }
  return out;
}

function isAxisAlignedRectangle(polygon: readonly Vec2[]): boolean {
  if (polygon.length !== 4) return false;
  return polygon.every((p, i) => {
    const q = polygon[(i + 1) % 4];
    return q !== undefined && (Math.abs(p.x - q.x) < 1e-9 || Math.abs(p.y - q.y) < 1e-9);
  });
}

/** Splits a polygon by the line through `p` with direction `d`; returns the left and right parts. */
function splitByLine(polygon: readonly Vec2[], p: Vec2, d: Vec2): [Vec2[], Vec2[]] {
  const side = (q: Vec2) => cross(d, sub(q, p));
  const clip = (keepLeft: boolean): Vec2[] => {
    const out: Vec2[] = [];
    const n = polygon.length;
    for (let i = 0; i < n; i++) {
      const a = polygon[i];
      const b = polygon[(i + 1) % n];
      if (!a || !b) continue;
      const sa = side(a);
      const sb = side(b);
      const inA = keepLeft ? sa >= -1e-9 : sa <= 1e-9;
      const inB = keepLeft ? sb >= -1e-9 : sb <= 1e-9;
      if (inA) out.push(a);
      if (inA !== inB) {
        const t = sa / (sa - sb);
        out.push(add(a, scale(sub(b, a), t)));
      }
    }
    return out;
  };
  return [clip(true), clip(false)];
}

function face(points2: readonly Vec2[], z: (p: Vec2) => number): RoofFace {
  const pts = points2.map((p) => ({ x: p.x, y: p.y, z: z(p) }));
  const planArea = area(points2);
  // A planar face over the plan: true area = plan area / cos(slope), where the slope
  // is the face normal's angle from vertical. Compute the normal from three points.
  let trueArea = planArea;
  const [a, b, c] = pts;
  if (a && b && c) {
    const u = { x: b.x - a.x, y: b.y - a.y, z: b.z - a.z };
    const v = { x: c.x - a.x, y: c.y - a.y, z: c.z - a.z };
    const nx = u.y * v.z - u.z * v.y;
    const ny = u.z * v.x - u.x * v.z;
    const nz = u.x * v.y - u.y * v.x;
    const len = Math.hypot(nx, ny, nz);
    const cos = len > 0 ? Math.abs(nz) / len : 1;
    trueArea = cos > 1e-9 ? planArea / cos : planArea;
  }
  return { points: pts, planArea, area: trueArea };
}

export function buildRoof(building: Building, topElevation: number): RoofGeometry {
  const roof = roofOf(building);
  // Without collinear vertices: a "+" on a wall must not turn a rectangle (hip) into a
  // six-cornered outline (gable fallback).
  const fp = cleanRing(
    isCounterClockwise(building.footprint) ? building.footprint : [...building.footprint].reverse(),
  );
  if (roof.kind === "flat") {
    const f = face(fp, () => topElevation);
    return {
      kind: "flat",
      builtKind: "flat",
      faces: [f],
      ridge: null,
      ridges: [],
      eaves: [...fp],
      area: f.area,
      ridgeHeight: 0,
      atticVolume: 0,
    };
  }
  const eaves = offsetPolygon(fp, roof.overhang);
  const tan = Math.tan(rad(roof.pitch));
  const { min, max } = bounds(eaves);
  const useHip = roof.kind === "hip" && isAxisAlignedRectangle(fp);
  // A hip ridge runs along the longer side; a gable follows the setting.
  const alongX = useHip ? max.x - min.x >= max.y - min.y : roof.ridgeAxis === "x";
  // Cross gable: a rectilinear footprint that is not a rectangle gets one gable per
  // rectangle of its decomposition along the ridge axis, each with its own ridge.
  if (!useHip && isRectilinear(eaves) && !isAxisAlignedRectangle(eaves)) {
    const rects = decomposeRectilinear(eaves, alongX ? "x" : "y");
    const faces: RoofFace[] = [];
    const ridges: { a: Vec3; b: Vec3 }[] = [];
    let atticVolume = 0;
    let ridgeHeight = 0;
    for (const r of rects) {
      const g = gableOverRectangle(r, alongX, tan, topElevation);
      faces.push(...g.faces);
      ridges.push(g.ridge);
      atticVolume += g.atticVolume;
      ridgeHeight = Math.max(ridgeHeight, g.ridgeHeight);
    }
    return {
      kind: roof.kind,
      builtKind: "gable",
      faces,
      ridge: ridges[0] ?? null,
      ridges,
      eaves,
      area: faces.reduce((s, f) => s + f.area, 0),
      ridgeHeight,
      atticVolume,
    };
  }
  const centre = { x: (min.x + max.x) / 2, y: (min.y + max.y) / 2 };
  const halfSpan = alongX ? (max.y - min.y) / 2 : (max.x - min.x) / 2;
  const ridgeHeight = halfSpan * tan;
  const zOf = (p: Vec2) => {
    const dist = alongX ? Math.abs(p.y - centre.y) : Math.abs(p.x - centre.x);
    return topElevation + Math.max(0, halfSpan - dist) * tan;
  };
  const faces: RoofFace[] = [];
  let ridge: { a: Vec3; b: Vec3 };
  if (useHip) {
    // Rectangle eaves: ridge shortened by half span at both ends, four planar faces.
    const long = alongX ? max.x - min.x : max.y - min.y;
    const ridgeLen = Math.max(0, long - 2 * halfSpan);
    const r0 = alongX
      ? { x: centre.x - ridgeLen / 2, y: centre.y }
      : { x: centre.x, y: centre.y - ridgeLen / 2 };
    const r1 = alongX
      ? { x: centre.x + ridgeLen / 2, y: centre.y }
      : { x: centre.x, y: centre.y + ridgeLen / 2 };
    const zHip = (p: Vec2) => {
      // Distance to the ridge segment decides the height on a hip.
      const t = alongX
        ? Math.min(1, Math.max(0, (p.x - r0.x) / Math.max(ridgeLen, 1e-9)))
        : Math.min(1, Math.max(0, (p.y - r0.y) / Math.max(ridgeLen, 1e-9)));
      const q = add(r0, scale(sub(r1, r0), ridgeLen > 0 ? t : 0));
      const dist = Math.max(Math.abs(p.x - q.x), Math.abs(p.y - q.y));
      return topElevation + Math.max(0, halfSpan - dist) * tan;
    };
    const [c0, c1, c2, c3] = eaves;
    if (!c0 || !c1 || !c2 || !c3) throw new Error("hip roof needs four eave corners");
    // Faces: each eave edge plus the nearest ridge end(s).
    const edgeFace = (a: Vec2, b: Vec2) => {
      const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      const isLongEdge = alongX ? Math.abs(a.y - b.y) < 1e-9 : Math.abs(a.x - b.x) < 1e-9;
      if (isLongEdge) {
        const near = (p: Vec2) => (alongX ? (p.x < centre.x ? r0 : r1) : p.y < centre.y ? r0 : r1);
        return face([a, b, near(b), near(a)], zHip);
      }
      const end = alongX ? (mid.x < centre.x ? r0 : r1) : mid.y < centre.y ? r0 : r1;
      return face([a, b, end], zHip);
    };
    faces.push(edgeFace(c0, c1), edgeFace(c1, c2), edgeFace(c2, c3), edgeFace(c3, c0));
    ridge = {
      a: { ...r0, z: topElevation + ridgeHeight },
      b: { ...r1, z: topElevation + ridgeHeight },
    };
  } else {
    const dir = alongX ? { x: 1, y: 0 } : { x: 0, y: 1 };
    const [left, right] = splitByLine(eaves, centre, dir);
    if (left.length >= 3) faces.push(face(left, zOf));
    if (right.length >= 3) faces.push(face(right, zOf));
    const a = alongX ? { x: min.x, y: centre.y } : { x: centre.x, y: min.y };
    const b = alongX ? { x: max.x, y: centre.y } : { x: centre.x, y: max.y };
    ridge = {
      a: { ...a, z: topElevation + ridgeHeight },
      b: { ...b, z: topElevation + ridgeHeight },
    };
  }
  // Attic volume: Σ plan area x (height at plan centroid - top) per planar face.
  const atticVolume = faces.reduce((s, f) => {
    const c = centroid(f.points.map((p) => ({ x: p.x, y: p.y })));
    const z = useHip ? 0 : zOf(c) - topElevation;
    return s + f.planArea * (useHip ? hipHeightAt(f, c) : z);
  }, 0);
  return {
    kind: roof.kind,
    builtKind: useHip ? "hip" : "gable",
    faces,
    ridge,
    ridges: [ridge],
    eaves,
    area: faces.reduce((s, f) => s + f.area, 0),
    ridgeHeight,
    atticVolume,
  };
}

/** Every edge is axis aligned. */
export function isRectilinear(polygon: readonly Vec2[]): boolean {
  return polygon.every((p, i) => {
    const q = polygon[(i + 1) % polygon.length];
    return q !== undefined && (Math.abs(p.x - q.x) < 1e-9 || Math.abs(p.y - q.y) < 1e-9);
  });
}

export interface Rect {
  min: Vec2;
  max: Vec2;
}

/**
 * Splits a rectilinear polygon into rectangles that are long along `axis`: cut it
 * into strips across the axis at every vertex coordinate, then merge neighbouring
 * strips with the same extent. An L shape gives its two wings.
 */
export function decomposeRectilinear(polygon: readonly Vec2[], axis: "x" | "y"): Rect[] {
  const cross = (p: Vec2) => (axis === "x" ? p.y : p.x);
  const along = (p: Vec2) => (axis === "x" ? p.x : p.y);
  const levels = [...new Set(polygon.map((p) => Math.round(cross(p) * 1e6) / 1e6))].sort(
    (a, b) => a - b,
  );
  const strips: { c0: number; c1: number; a0: number; a1: number }[] = [];
  for (let i = 0; i + 1 < levels.length; i++) {
    const c0 = levels[i];
    const c1 = levels[i + 1];
    if (c0 === undefined || c1 === undefined) continue;
    const mid = (c0 + c1) / 2;
    // A line through the strip middle crosses the polygon at edges running across the axis.
    const xs: number[] = [];
    for (let k = 0; k < polygon.length; k++) {
      const p = polygon[k];
      const q = polygon[(k + 1) % polygon.length];
      if (!p || !q) continue;
      const lo = Math.min(cross(p), cross(q));
      const hi = Math.max(cross(p), cross(q));
      if (Math.abs(cross(p) - cross(q)) < 1e-9) continue;
      if (mid > lo && mid < hi) xs.push(along(p));
    }
    xs.sort((a, b) => a - b);
    for (let k = 0; k + 1 < xs.length; k += 2) {
      const a0 = xs[k];
      const a1 = xs[k + 1];
      if (a0 !== undefined && a1 !== undefined) strips.push({ c0, c1, a0, a1 });
    }
  }
  // Merge strips stacked across the axis with the same along-extent.
  const merged: typeof strips = [];
  for (const s of strips.sort((p, q) => p.a0 - q.a0 || p.c0 - q.c0)) {
    const prev = merged.find(
      (m) =>
        Math.abs(m.a0 - s.a0) < 1e-9 &&
        Math.abs(m.a1 - s.a1) < 1e-9 &&
        Math.abs(m.c1 - s.c0) < 1e-9,
    );
    if (prev) prev.c1 = s.c1;
    else merged.push({ ...s });
  }
  return merged.map((m) =>
    axis === "x"
      ? { min: { x: m.a0, y: m.c0 }, max: { x: m.a1, y: m.c1 } }
      : { min: { x: m.c0, y: m.a0 }, max: { x: m.c1, y: m.a1 } },
  );
}

function gableOverRectangle(r: Rect, alongX: boolean, tan: number, top: number) {
  const centre = { x: (r.min.x + r.max.x) / 2, y: (r.min.y + r.max.y) / 2 };
  const halfSpan = alongX ? (r.max.y - r.min.y) / 2 : (r.max.x - r.min.x) / 2;
  const ridgeHeight = halfSpan * tan;
  const zOf = (p: Vec2) => {
    const dist = alongX ? Math.abs(p.y - centre.y) : Math.abs(p.x - centre.x);
    return top + Math.max(0, halfSpan - dist) * tan;
  };
  const a = r.min;
  const b = { x: r.max.x, y: r.min.y };
  const c = r.max;
  const d = { x: r.min.x, y: r.max.y };
  const halves: Vec2[][] = alongX
    ? [
        [a, b, { x: r.max.x, y: centre.y }, { x: r.min.x, y: centre.y }],
        [{ x: r.min.x, y: centre.y }, { x: r.max.x, y: centre.y }, c, d],
      ]
    : [
        [a, { x: centre.x, y: r.min.y }, { x: centre.x, y: r.max.y }, d],
        [{ x: centre.x, y: r.min.y }, b, c, { x: centre.x, y: r.max.y }],
      ];
  const faces = halves.map((h) => face(h, zOf));
  const ra = alongX ? { x: r.min.x, y: centre.y } : { x: centre.x, y: r.min.y };
  const rb = alongX ? { x: r.max.x, y: centre.y } : { x: centre.x, y: r.max.y };
  const atticVolume = faces.reduce(
    (s, f) => s + f.planArea * (zOf(centroid(f.points.map((p) => ({ x: p.x, y: p.y })))) - top),
    0,
  );
  return {
    faces,
    ridge: { a: { ...ra, z: top + ridgeHeight }, b: { ...rb, z: top + ridgeHeight } },
    ridgeHeight,
    atticVolume,
  };
}

/** Height of a planar face above its lowest point at a plan point, from the plane through its first three vertices. */
function hipHeightAt(f: RoofFace, p: Vec2): number {
  const [a, b, c] = f.points;
  if (!a || !b || !c) return 0;
  const u = { x: b.x - a.x, y: b.y - a.y, z: b.z - a.z };
  const v = { x: c.x - a.x, y: c.y - a.y, z: c.z - a.z };
  const nx = u.y * v.z - u.z * v.y;
  const ny = u.z * v.x - u.x * v.z;
  const nz = u.x * v.y - u.y * v.x;
  if (Math.abs(nz) < 1e-12) return 0;
  const z = a.z - (nx * (p.x - a.x) + ny * (p.y - a.y)) / nz;
  const base = Math.min(...f.points.map((q) => q.z));
  return z - base;
}
