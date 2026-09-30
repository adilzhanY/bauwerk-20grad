import { Vector3 } from "three";
import { bearingInPlan } from "@/geometry/geo";
import type { GeoOrigin, Vec2 } from "@/geometry/types";
import type { CameraView } from "@/store/building";

/** Compass bearing each elevation looks from: "n" stands north of the building, facing south. */
const ELEVATION_BEARING: Record<"n" | "e" | "s" | "w", number> = { n: 0, e: 90, s: 180, w: 270 };

/** Where the camera stands for a view, around the building centre at a fitting distance. */
export function viewPosition(
  view: CameraView,
  centre: Vector3,
  distance: number,
  origin: GeoOrigin | undefined,
): Vector3 {
  // A plan direction in world space: plan y is world -z (three.ts).
  const along = (d: Vec2, k: number) => new Vector3(d.x * k, 0, -d.y * k);
  if (view === "3d") {
    // From the plan's north-east, above.
    return centre.clone().add(new Vector3(distance * 0.8, distance * 0.7, -distance * 0.8));
  }
  if (view === "top") {
    // Straight down, a hair south of the centre so north is up on the screen.
    const south = bearingInPlan(origin, 180);
    return centre
      .clone()
      .add(along(south, 0.01))
      .setY(centre.y + distance * 1.4);
  }
  const from = bearingInPlan(origin, ELEVATION_BEARING[view]);
  return centre
    .clone()
    .add(along(from, distance * 1.2))
    .setY(centre.y + distance * 0.06);
}

/**
 * Whether a view choice (3D, top, an elevation) should move the camera now. A choice moves
 * the camera once: not again when the controls are replaced, which happens every time the
 * floor plan is switched on or off, and never while the floor plan's own top-down camera is
 * the one on screen.
 */
export function shouldApplyView(
  nonce: number,
  lastApplied: number,
  planView: boolean,
  orthographic: boolean,
): boolean {
  return nonce !== 0 && nonce !== lastApplied && !planView && !orthographic;
}
