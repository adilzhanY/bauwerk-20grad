import { useEffect, useState } from "react";
import type * as THREE from "three";
import type { BuildingDetail, Neighbour } from "lod2-core/api";
import type { SurfaceKind } from "lod2-core/types";
import { buildTerrainMesh, type TerrainMesh } from "lod2-core/terrain";
import { mergeMeshes } from "./geometry.ts";
import { triples } from "./points";

/** The two expensive products of a selection, once they exist. */
export interface SceneContext {
  /** Ground surface warped to the contact lines in view. */
  terrain: TerrainMesh;
  /** Neighbour buildings, one merged buffer per surface kind. */
  neighbourGeometries: [SurfaceKind, THREE.BufferGeometry][];
}

export interface SceneContextInput {
  /** Null before a building is selected; the hook then produces nothing. */
  detail: BuildingDetail | null;
  neighbours: Neighbour[];
  /** The context orthophoto's extent: the frame both the drape and the ground share. */
  contextBBox: readonly [number, number, number, number] | undefined;
  base: [number, number, number];
  groundZ: number | null;
}

/** Rings in absolute coordinates: a mesh stores them rebased on its own origin. */
function absolute(
  rings: number[][] | undefined,
  origin: readonly [number, number, number],
): number[][] {
  return (rings ?? []).map((ring) => {
    const out: number[] = Array.from({ length: ring.length }, () => 0);
    let i = 0;
    for (const [x, y, z] of triples(ring)) {
      out[i] = x + origin[0];
      out[i + 1] = y + origin[1];
      out[i + 2] = z + origin[2];
      i += 3;
    }
    return out;
  });
}

/**
 * Build the expensive half of the scene after the browser has painted, once per input change.
 *
 * This exists because of a specific failure, and the shape of the fix is the whole point.
 *
 * Merging ~1,200 neighbour meshes and interpolating the ground from every contact line in view
 * is roughly a second of straight-line work. Done in a render-phase `useMemo` it blocks before
 * the browser has painted anything, so no progress indicator can appear, and done in a
 * *concurrent* render (`useDeferredValue` and friends) it is worse, because any state update
 * can interrupt that render and React starts it again from scratch. With `usePendingPoll`
 * ticking every 2.5 seconds against a pass costing about a second, it never finished: measured
 * over a Berlin view, `sampleHeight` alone burned 52 of 63 seconds of blocked main thread,
 * nearly all of it thrown away and redone. Chrome offered to kill the page.
 *
 * An effect is neither interruptible nor retried, and it runs after paint. One frame of
 * `requestAnimationFrame` headroom on top guarantees the loading state is actually on screen
 * before the main thread goes away. The work then happens exactly once.
 *
 * `building` is true from the moment the inputs change until the result for those inputs
 * exists, which is precisely what a progress indicator wants to know.
 */
export function useSceneContext(input: SceneContextInput): {
  context: SceneContext | null;
  building: boolean;
} {
  const { detail, neighbours, contextBBox, base, groundZ } = input;
  // The result together with the inputs it was built from. A result for other inputs belongs
  // to the building that was selected before this one, and showing it under the new one would
  // be wrong, not merely stale, so it is never returned.
  const [result, setResult] = useState<{
    inputs: readonly unknown[];
    context: SceneContext;
  } | null>(null);
  const inputs = [detail, neighbours, contextBBox, base, groundZ] as const;

  useEffect(() => {
    if (!detail || !contextBBox) return;
    let alive = true;

    const frame = requestAnimationFrame(() => {
      if (!alive) return;
      const [minX, minY, maxX, maxY] = contextBBox;

      const rimRings: number[][] = [];
      const constraints: number[][] = [];
      const holes: number[][] = [];

      for (const part of detail.parts) {
        if (!part.mesh) continue;
        const rings = absolute(part.mesh.terrain, part.mesh.origin);
        constraints.push(...rings);
        // Footprints cut the grid, so terrain never covers a building.
        for (const surface of part.mesh.surfaces) {
          if (surface.kind === "ground") holes.push(...absolute(surface.rings, part.mesh.origin));
        }
        // Only the published contact line. A footprint has no z of its own, so a part without
        // one contributes nothing exact, so the surface is interpolated there instead.
        rimRings.push(...rings);
      }

      for (const n of neighbours) {
        if (!n.mesh) continue;
        constraints.push(...absolute(n.mesh.terrain, n.mesh.origin));
        for (const surface of n.mesh.surfaces) {
          if (surface.kind === "ground") holes.push(...absolute(surface.rings, n.mesh.origin));
        }
      }

      const terrain = buildTerrainMesh({
        bbox: { minX, minY, maxX, maxY },
        rimRings,
        constraints,
        holes,
        fallbackZ: groundZ ?? base[2],
        origin: base,
      });

      // Merged into one buffer per surface kind: a mesh each would be well over a thousand
      // draw calls a frame.
      // No second `alive` check needed: this callback runs to its end in one go, so the
      // cleanup cannot have run since the check above.
      const neighbourGeometries = [...mergeMeshes(neighbours, base, contextBBox)];
      setResult({
        inputs: [detail, neighbours, contextBBox, base, groundZ],
        context: { terrain, neighbourGeometries },
      });
    });

    return () => {
      alive = false;
      cancelAnimationFrame(frame);
      // Drop the previous result right away, so its buffers are released below.
      setResult(null);
    };
  }, [detail, neighbours, contextBBox, base, groundZ]);

  // GPU buffers outlive the render that made them, so they have to be released explicitly
  // when they are replaced or the scene goes away.
  useEffect(
    () => () => {
      for (const [, g] of result?.context.neighbourGeometries ?? []) g.dispose();
    },
    [result],
  );

  const context = result?.inputs.every((value, i) => value === inputs[i]) ? result.context : null;

  return { context, building: Boolean(detail && contextBBox) && context === null };
}
