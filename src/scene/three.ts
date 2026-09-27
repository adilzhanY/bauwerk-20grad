import type { BufferGeometry } from "three";
import { ExtrudeGeometry, Mesh, Shape, ShapeGeometry, Vector2, Vector3 } from "three";
import { LineSegments2 } from "three-stdlib";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import type { Vec2 } from "@/geometry/types";

/**
 * Plan space and world space.
 *
 * The scene's content is built in plan space: a plan point (x, y) at height h is (x, h, y),
 * shapes built in XY and rotated down. That space is left handed next to a map (with north
 * up, east would be on the left), so the Viewport puts all content in one group mirrored in
 * z, PLAN_MIRROR. In world space a plan point is then (x, h, -y): east is on the right of
 * north, as on the map, and facade photos and map tiles read the right way round.
 *
 * Code inside the group keeps using plan space. Code that meets world space directly (the
 * pointer ray, the camera, the renderer's clipping planes) converts with the two functions
 * below.
 */
export const PLAN_MIRROR: [number, number, number] = [1, 1, -1];

/** A plan point at height `height` in world space. */
export const planToWorld = (point: Vec2, height = 0): Vector3 =>
  new Vector3(point.x, height, -point.y);

/** The plan point under a world position. */
export const worldToPlan = (world: { x: number; z: number }): Vec2 => ({
  x: world.x,
  y: -world.z,
});

export function planShape(polygon: readonly Vec2[]): Shape {
  return new Shape(polygon.map((p) => new Vector2(p.x, -p.y)));
}

/** Vertical prism over a plan polygon from `bottom` to `top` metres. */
export function prismGeometry(plan: readonly Vec2[], bottom: number, top: number): BufferGeometry {
  const geometry = new ExtrudeGeometry(planShape(plan), {
    depth: Math.max(top - bottom, 1e-4),
    bevelEnabled: false,
  });
  geometry.rotateX(-Math.PI / 2);
  geometry.translate(0, bottom, 0);
  return geometry;
}

/** Flat polygon lying on the plan at height `y`. */
export function flatGeometry(plan: readonly Vec2[], y: number): BufferGeometry {
  const geometry = new ShapeGeometry(planShape(plan));
  geometry.rotateX(-Math.PI / 2);
  geometry.translate(0, y, 0);
  return geometry;
}

export function mergeAll(geometries: BufferGeometry[]): BufferGeometry {
  if (geometries.length === 1 && geometries[0]) return geometries[0];
  const merged = mergeGeometries(geometries, false);
  for (const g of geometries) g.dispose();
  return merged;
}

/** Explicit raycast functions used when a mesh changes between interactive and inert. */
export const meshRaycast: Mesh["raycast"] = function raycast(this: Mesh, raycaster, intersects) {
  Mesh.prototype.raycast.call(this, raycaster, intersects);
};

export const noRaycast = () => undefined;

export const lineRaycast: LineSegments2["raycast"] = function raycast(
  this: LineSegments2,
  raycaster,
  intersects,
) {
  LineSegments2.prototype.raycast.call(this, raycaster, intersects);
};

/** Rotation about Y that turns local +X into the plan direction (dx, dy). */
export const yawFor = (direction: Vec2): number => Math.atan2(-direction.y, direction.x);
