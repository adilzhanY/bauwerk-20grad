import { Color } from "three";
import type { StoreyDisplay } from "./display";
import { useSceneColors } from "./useSceneColors";

/**
 * A storey shown as a ghost is drawn opaque, its colours faded toward the view's background
 * (a halftone, as Revit draws the storeys below the one being edited). Transparent ghosts
 * stacked: through a storey with many interior walls the eye met six or more see-through
 * layers, which read as solid, with holes and floating boxes wherever fewer lined up.
 * Opaque, every pixel shows only the nearest surface, the same from every angle.
 *
 * `opacity` is the ghost opacity setting (0 to 1): how much of its own colour a ghost keeps.
 * Even at 0 a quarter remains, so the storeys below always read as a building.
 */
export function ghostColor(color: string, background: string, opacity: number): string {
  const keep = 0.25 + 0.75 * Math.min(Math.max(opacity, 0), 1);
  return `#${new Color(background).lerp(new Color(color), keep).getHexString()}`;
}

/** The colour to draw with: as it is, or faded when the storey is a ghost. */
export function useGhost(display: StoreyDisplay, opacity: number): (color: string) => string {
  const { bg } = useSceneColors();
  return (color) => (display === "ghost" ? ghostColor(color, bg, opacity) : color);
}
