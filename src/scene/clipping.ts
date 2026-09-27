import { Plane, Vector3 } from "three";

export type CutAxis = "horizontal" | "x" | "y";

/**
 * Clipping plane for the section cut. Three.js keeps everything on the side the
 * normal points to with `constant` as the signed distance from the origin, so
 * for a horizontal cut at height h that keeps the part below, the normal is
 * -Y and the constant is +h. For a cut along x at plan x = v keeping x < v, the
 * normal is -X and the constant is +v. Plan y is world -z (three.ts), so keeping plan y < v
 * keeps world z > -v: the normal is +Z and the constant is +v.
 */
export function cutPlane(axis: CutAxis, value: number): Plane {
  switch (axis) {
    case "horizontal":
      return new Plane(new Vector3(0, -1, 0), value);
    case "x":
      return new Plane(new Vector3(-1, 0, 0), value);
    case "y":
      return new Plane(new Vector3(0, 0, 1), value);
  }
}

/** Distance of a world point to the kept side; positive means visible. */
export function signedDistance(plane: Plane, point: [number, number, number]): number {
  return plane.distanceToPoint(new Vector3(...point));
}
