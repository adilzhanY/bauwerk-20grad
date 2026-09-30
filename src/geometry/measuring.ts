/**
 * Where the measure tool puts a point. A distance is measured between what is seen, so near a
 * wall the point lies on that wall's face (the inner face of an exterior wall, the face of an
 * interior wall on the pointer's side); anywhere else, inside or outside the building, it is
 * free, to the centimetre. From a first point, a line close to one of the building's main
 * directions locks onto it, and a locked line ending near a wall ends exactly where it meets
 * that wall's face, so wall to wall distances come out square.
 */
import { add, cross, dot, normalize, scale, sub } from "./polygon";
import type { Vec2 } from "./types";
import { ANGLE_SNAP_DEG, buildingAxes, snapToWall } from "./wallDrawing";
import type { WallContext } from "./wallDrawing";

const cm = (v: number) => Math.round(v * 100) / 100;

export function measurePoint(
  cursor: Vec2,
  ctx: WallContext,
  radius: number,
  from: Vec2 | null = null,
): Vec2 {
  let target = cursor;
  let lock: Vec2 | null = null;
  if (from) {
    const towards = sub(cursor, from);
    if (Math.hypot(towards.x, towards.y) > 1e-9) {
      const dir = normalize(towards);
      const within = Math.cos((ANGLE_SNAP_DEG * Math.PI) / 180);
      lock = buildingAxes(ctx.footprint).find((axis) => dot(dir, axis) >= within) ?? null;
      if (lock) target = add(from, scale(lock, dot(towards, lock)));
    }
  }
  // Openings do not matter here: a distance may well end on a window.
  const snap = snapToWall(target, { ...ctx, openings: [] }, radius);
  if (snap) {
    if (from && lock) {
      // Where the locked line meets the face of that wall.
      const denom = cross(lock, snap.along);
      if (Math.abs(denom) > 1e-9) {
        const t = cross(sub(snap.shown, from), snap.along) / denom;
        return add(from, scale(lock, t));
      }
    }
    return snap.shown;
  }
  if (from && lock) return add(from, scale(lock, cm(dot(sub(target, from), lock))));
  return { x: cm(target.x), y: cm(target.y) };
}
