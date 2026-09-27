import { useEffect, useMemo } from "react";
import * as THREE from "three";
import type { TerrainMesh } from "lod2-core/terrain";
import { triples } from "./points";

/**
 * The orthophoto draped on the ground the model implies, instead of on a flat plane.
 *
 * The heights come from `bldg:lod2TerrainIntersection`, the line where each building's walls
 * meet the ground, and the only terrain information in the data. So the surface is *exact*
 * along the selected building's own line and interpolated between its neighbours': honest as
 * a picture of the ground, and not to be read as a survey. There is no bare-earth terrain
 * model wired up; `buildTerrainMesh` takes an optional `field` callback which is where one
 * would plug in.
 *
 * Warping is free for the drape: the orthophoto's UV depends on x and y alone, so moving a
 * vertex up or down cannot slide the image across it.
 *
 * The mesh arrives prebuilt from `useSceneContext`, which does the interpolation after paint
 * rather than during a render (see the note there for why that matters). All that is left
 * here is the Z-up to Y-up swap and a material.
 */
export function TerrainSurface({
  mesh,
  texture,
}: {
  mesh: TerrainMesh;
  texture: THREE.Texture | null;
}) {
  const geometry = useMemo(() => {
    const g = new THREE.BufferGeometry();
    // Source data is Z-up, the scene is Y-up, the same swap the building meshes use.
    const p = mesh.positions;
    const swapped = new Float32Array(p.length);
    let i = 0;
    for (const [x, y, z] of triples(p)) {
      swapped[i] = x;
      swapped[i + 1] = z;
      swapped[i + 2] = -y;
      i += 3;
    }
    g.setAttribute("position", new THREE.BufferAttribute(swapped, 3));
    g.setAttribute("uv", new THREE.BufferAttribute(mesh.uvs, 2));
    g.setIndex(new THREE.BufferAttribute(mesh.indices, 1));
    return g;
  }, [mesh]);

  useEffect(
    () => () => {
      geometry.dispose();
    },
    [geometry],
  );
  if (!texture || !mesh.indices.length) return null;

  return (
    // Double-sided: a warped surface seen from below at street level would otherwise vanish,
    // and the winding of a hand-built grid is not worth defending for one material.
    <mesh geometry={geometry} renderOrder={0}>
      <meshBasicMaterial key={texture.uuid} map={texture} side={THREE.DoubleSide} />
    </mesh>
  );
}
