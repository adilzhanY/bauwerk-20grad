import type { Vec2 } from "@/geometry/types";

export interface PlanCamera {
  /** World position of the orthographic camera, straight above the footprint centre. */
  position: [number, number, number];
  /** Orthographic zoom so the footprint fits with a margin, in pixels per metre. */
  zoom: number;
  target: [number, number, number];
}

/** Pixels at each edge of the viewport covered by floating cards. */
export interface PlanInsets {
  left: number;
  right: number;
  top: number;
  bottom: number;
}

const NO_INSETS: PlanInsets = { left: 0, right: 0, top: 0, bottom: 0 };

/**
 * Orthographic top-down camera over the active storey. Zoom is pixels per metre: the
 * footprint plus a margin (room for the dimension lines) fills the part of the viewport the
 * floating cards leave free, and the camera shifts so the drawing sits in the middle of it.
 */
export function planCamera(
  bounds: { min: Vec2; max: Vec2 },
  viewport: { width: number; height: number },
  elevation: number,
  margin = 2,
  insets: PlanInsets = NO_INSETS,
): PlanCamera {
  const cx = (bounds.min.x + bounds.max.x) / 2;
  const cz = (bounds.min.y + bounds.max.y) / 2;
  const w = bounds.max.x - bounds.min.x + 2 * margin;
  const h = bounds.max.y - bounds.min.y + 2 * margin;
  const freeWidth = Math.max(1, viewport.width - insets.left - insets.right);
  const freeHeight = Math.max(1, viewport.height - insets.top - insets.bottom);
  const zoom = Math.max(1, Math.min(freeWidth / w, freeHeight / h));
  // The camera looks down with world -z up the screen, and plan y is world -z (three.ts): screen
  // right is plan x (east), screen up is plan y (north), screen down is world +z. Moving the
  // drawing right and down into the free area moves the camera the other way.
  const x = cx - (insets.left - insets.right) / 2 / zoom;
  const z = -cz - (insets.top - insets.bottom) / 2 / zoom;
  return { position: [x, elevation + 50, z], zoom, target: [x, elevation, z] };
}

/** Maps a screen pixel to a plan point under the orthographic plan camera. */
export function planPointFromScreen(
  camera: PlanCamera,
  viewport: { width: number; height: number },
  px: number,
  py: number,
): Vec2 {
  const dx = (px - viewport.width / 2) / camera.zoom;
  const dy = (py - viewport.height / 2) / camera.zoom;
  // Screen down is world +z, which is plan -y: north is up on the screen.
  return { x: camera.position[0] + dx, y: -(camera.position[2] + dy) };
}
