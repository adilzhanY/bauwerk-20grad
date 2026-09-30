import type { SurfaceKind } from "lod2-core/types";

/**
 * Neighbours are context. Their roofs carry the same imagery as the selection, so the
 * distinction has to come from the walls: cool and mid-toned here against the selected
 * building's warm cream, which keeps them from reading as the subject.
 */
export const NEIGHBOUR_COLORS: Record<SurfaceKind, string> = {
  roof: "#9aa6b2",
  wall: "#9fabb8",
  ground: "#6b7683",
  closure: "#a49dbb",
  unknown: "#98a2ad",
};

/**
 * How present the surrounding buildings are next to the selected one.
 *
 * Expressed as brightness rather than alpha, deliberately. An 800 m box holds several
 * hundred buildings, and at 0.7 alpha every one of them blends with whatever is behind it,
 * so the scene turns milky and the imagery is lost. Worse, the neighbours share one merged
 * buffer per surface kind for speed, and triangles inside a single buffer cannot be
 * depth-sorted, so the blending is order-dependent.
 *
 * Opaque geometry dimmed to 70% gives the same "almost as prominent as the selection"
 * reading, keeps every roof image legible, and costs nothing to draw.
 */
export const NEIGHBOUR_BRIGHTNESS = 0.7;

export const COLORS: Record<SurfaceKind, string> = {
  roof: "#c2603f",
  wall: "#e8e2d9",
  ground: "#6b7280",
  // Closure surfaces are virtual lids, not fabric, so show them as such.
  closure: "#8b5cf6",
  unknown: "#9ca3af",
};
