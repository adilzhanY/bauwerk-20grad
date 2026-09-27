import { useMemo } from "react";
import { wallArea, wallAzimuth, wallToPlane, type WallPlane } from "lod2-core/wall";
import { useSelectedSurface, wallAboveGround } from "../../state/selectedWall.ts";

/** What the editor needs to know about the wall picked in the 3D view. */
export interface WallGeometry {
  /** Outer ring of the wall in mesh coordinates, or null when nothing is selected. */
  ring: number[] | null;
  /** The wall above street level, in its own metres. Null when the surface is not a vertical wall. */
  plane: WallPlane | null;
  /** Street level along the wall from the terrain contact line, or null when unknown. */
  groundZ: number | null;
  /** How much of the model wall sits below the street, in metres. */
  buriedDepth: number;
  /** Model wall area above ground, the denominator of the window-to-wall ratio. */
  area: number;
  /** Compass bearing the wall faces, in degrees. */
  facing: number | null;
}

/** Plane, ground level, area and facing of the selected wall, recomputed only when it changes. */
export function useWallGeometry(): WallGeometry {
  const selected = useSelectedSurface();
  const ring = selected?.ring ?? null;
  const terrain = selected?.terrain ?? null;

  return useMemo(() => {
    if (!ring || !terrain)
      return { ring: null, plane: null, groundZ: null, buriedDepth: 0, area: 0, facing: null };
    // Street level along this wall from the contact line. Without it the model's floor slab
    // is the bottom, which can sit many metres below the street.
    const { groundZ, plane } = wallAboveGround(ring, terrain);
    const fullPlane = wallToPlane(ring);
    const buriedDepth = groundZ !== null && fullPlane ? fullPlane.height - (plane?.height ?? 0) : 0;
    return {
      ring,
      plane,
      groundZ,
      buriedDepth,
      area: wallArea(ring, groundZ ?? undefined),
      facing: wallAzimuth(ring),
    };
  }, [ring, terrain]);
}
