import { Plane, Vector3 } from "three";
import type { ThreeEvent } from "@react-three/fiber";
import type { Vec2 } from "@/geometry/types";
import { planToWorld, worldToPlan } from "../three";

const scratch = new Vector3();

/** Where the pointer ray hits the horizontal plane at height y, as a plan point. */
export function pointOnLevel(e: ThreeEvent<PointerEvent | MouseEvent>, y: number): Vec2 | null {
  const plane = new Plane(new Vector3(0, 1, 0), -y);
  const hit = e.ray.intersectPlane(plane, scratch);
  return hit ? worldToPlan(hit) : null;
}

/** Where the pointer ray hits a vertical plane through `origin` with plan normal `normal`. */
export function pointOnVertical(
  e: ThreeEvent<PointerEvent | MouseEvent>,
  origin: Vec2,
  normal: Vec2,
): Vec2 | null {
  const n = planToWorld(normal);
  const plane = new Plane().setFromNormalAndCoplanarPoint(n, planToWorld(origin));
  const hit = e.ray.intersectPlane(plane, scratch);
  return hit ? worldToPlan(hit) : null;
}
