import type { BuildingDetail, Mesh } from "lod2-core/api";
import { wallGroundLevel, wallToPlane, type WallPlane } from "lod2-core/wall";
import { useStore, type WallRef } from "./store.ts";

export interface SelectedSurface {
  ref: WallRef;
  kind: Mesh["surfaces"][number]["kind"];
  /** Outer ring in mesh coordinates, x y z per vertex. */
  ring: number[];
  /** The building part's terrain contact line, on the same mesh origin. */
  terrain: number[][];
}

const NO_TERRAIN: number[][] = [];

/** The selected surface in this building, or null when nothing is selected or it is gone. */
function findSurface(building: BuildingDetail | null, ref: WallRef | null): SelectedSurface | null {
  if (!building || !ref) return null;
  const mesh = building.parts.find((p) => p.gid === ref.partGid)?.mesh;
  const surface = mesh?.surfaces[ref.surfaceIndex];
  const ring = surface?.rings[0];
  if (!mesh || !surface || !ring) return null;
  return { ref, kind: surface.kind, ring, terrain: mesh.terrain ?? NO_TERRAIN };
}

/**
 * The surface picked in the 3D view, looked up once for everyone who needs it: the info
 * panel, the caption in the 3D view, and the photo editor.
 */

export function useSelectedSurface(): SelectedSurface | null {
  const building = useStore((s) => s.building);
  const ref = useStore((s) => s.selectedWall);
  return findSurface(building, ref);
}

/**
 * A wall ring cut at street level. The ground comes from the terrain contact line; without
 * one, `groundZ` is null and the plane is the full model wall down to its floor slab.
 */
export function wallAboveGround(
  ring: number[],
  terrain: number[][],
): { groundZ: number | null; plane: WallPlane | null } {
  const groundZ = wallGroundLevel(ring, terrain);
  return { groundZ, plane: wallToPlane(ring, groundZ ?? undefined) };
}
