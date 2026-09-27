import * as THREE from "three";
import { orthoUv, triangulatePolygon } from "lod2-core/geometry";
import type { Mesh as MeshDto } from "lod2-core/api";
import type { SurfaceKind } from "lod2-core/types";
import { triangleCorners, triples } from "./points";

/**
 * Build one BufferGeometry per surface kind from a stored mesh.
 *
 * The mesh arrives already rebased to a local origin in metres (UTM is metric, so no
 * projection maths is needed in the browser), and `triangulatePolygon` returns triangles
 * wound to match each face's own normal, so lighting is correct without DoubleSide.
 *
 * Rings within one surface alternate exterior/interior in the source order, but LoD2
 * surfaces are effectively always single-ring, so each ring is treated as its own face.
 *
 * When `uvBBox` is given, roof surfaces also get a `uv` attribute for draping an
 * orthophoto. UVs are computed from the vertex's *world* position (local + mesh.origin),
 * not its rebased position, so they are independent of whichever part the scene happens to
 * be centred on. Only roofs: a straight-down projection onto a vertical wall smears one
 * row of pixels down the whole facade.
 */
function accumulate(
  mesh: MeshDto,
  offset: [number, number, number],
  uvBBox: readonly [number, number, number, number] | undefined,
  posByKind: Map<SurfaceKind, number[]>,
  uvByKind: Map<SurfaceKind, number[]>,
): void {
  for (const surface of mesh.surfaces) {
    const target = posByKind.get(surface.kind) ?? [];
    const uvBox = surface.kind === "roof" ? uvBBox : undefined;
    const uvTarget = uvByKind.get(surface.kind) ?? [];

    for (const ring of surface.rings) {
      if (ring.length < 12) continue;
      const tri = triangulatePolygon({ exterior: ring, interiors: [] });
      for (const [lx, ly, lz] of triangleCorners(tri)) {
        // Source is Z-up (UTM easting/northing/height); three.js is Y-up.
        target.push(lx + offset[0], lz + offset[2], -(ly + offset[1]));
        if (uvBox) {
          const [u, v] = orthoUv(lx + mesh.origin[0], ly + mesh.origin[1], uvBox);
          uvTarget.push(u, v);
        }
      }
    }
    posByKind.set(surface.kind, target);
    if (uvBox) uvByKind.set(surface.kind, uvTarget);
  }
}

function toGeometries(
  posByKind: Map<SurfaceKind, number[]>,
  uvByKind: Map<SurfaceKind, number[]>,
): Map<SurfaceKind, THREE.BufferGeometry> {
  const out = new Map<SurfaceKind, THREE.BufferGeometry>();
  for (const [kind, verts] of posByKind) {
    if (!verts.length) continue;
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(verts, 3));
    const uvs = uvByKind.get(kind);
    if (uvs && uvs.length * 3 === verts.length * 2) {
      g.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
    }
    g.computeVertexNormals();
    out.set(kind, g);
  }
  return out;
}

/**
 * Build one BufferGeometry per surface kind from a stored mesh.
 *
 * The mesh arrives already rebased to a local origin in metres (UTM is metric, so no
 * projection maths is needed in the browser), and `triangulatePolygon` returns triangles
 * wound to match each face's own normal, so lighting is correct without DoubleSide.
 *
 * When `uvBBox` is given, roof surfaces also get a `uv` attribute for draping an
 * orthophoto. UVs are computed from the vertex's *world* position (local + mesh.origin),
 * not its rebased position, so they are independent of whichever part the scene happens to
 * be centred on. Only roofs: a straight-down projection onto a vertical wall smears one
 * row of pixels down the whole facade.
 */
export function meshToGeometries(
  mesh: MeshDto,
  offset: [number, number, number] = [0, 0, 0],
  uvBBox?: readonly [number, number, number, number],
): Map<SurfaceKind, THREE.BufferGeometry> {
  const posByKind = new Map<SurfaceKind, number[]>();
  const uvByKind = new Map<SurfaceKind, number[]>();
  accumulate(mesh, offset, uvBBox, posByKind, uvByKind);
  return toGeometries(posByKind, uvByKind);
}

/**
 * Merge many meshes into one geometry per surface kind.
 *
 * A 300 m box holds several hundred buildings, and one mesh each would mean well over a
 * thousand draw calls per frame. They share a material anyway, so they can share a buffer.
 */
export function mergeMeshes(
  meshes: { mesh: MeshDto | null }[],
  base: [number, number, number],
  uvBBox?: readonly [number, number, number, number],
): Map<SurfaceKind, THREE.BufferGeometry> {
  const posByKind = new Map<SurfaceKind, number[]>();
  const uvByKind = new Map<SurfaceKind, number[]>();
  for (const { mesh } of meshes) {
    if (!mesh) continue;
    const o = mesh.origin;
    accumulate(mesh, [o[0] - base[0], o[1] - base[1], o[2] - base[2]], uvBBox, posByKind, uvByKind);
  }
  return toGeometries(posByKind, uvByKind);
}

/** Geometry for one roof plane, so it can be highlighted independently. */
export function roofPlaneGeometries(mesh: MeshDto): THREE.BufferGeometry[] {
  const geoms: THREE.BufferGeometry[] = [];
  for (const surface of mesh.surfaces) {
    if (surface.kind !== "roof") continue;
    for (const ring of surface.rings) {
      if (ring.length < 12) continue;
      const verts: number[] = [];
      for (const [x, y, z] of triangleCorners(
        triangulatePolygon({ exterior: ring, interiors: [] }),
      )) {
        verts.push(x, z, -y);
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute("position", new THREE.Float32BufferAttribute(verts, 3));
      g.computeVertexNormals();
      geoms.push(g);
    }
  }
  return geoms;
}

/**
 * Bounding sphere of a set of part meshes, in three.js coordinates, after rebasing
 * them all onto the first part's origin. Used to frame the camera on what will
 * actually be drawn rather than on a guess from one part.
 */
export function focusOf(meshes: MeshDto[]): { center: THREE.Vector3; radius: number } {
  const base = meshes[0]?.origin ?? [0, 0, 0];
  const box = new THREE.Box3();
  let seen = false;

  for (const mesh of meshes) {
    const dx = mesh.origin[0] - base[0];
    const dy = mesh.origin[1] - base[1];
    const dz = mesh.origin[2] - base[2];
    for (const surface of mesh.surfaces) {
      for (const ring of surface.rings) {
        for (const [x, y, z] of triples(ring)) {
          // Z-up source -> Y-up three.js.
          box.expandByPoint(new THREE.Vector3(x + dx, z + dz, -(y + dy)));
          seen = true;
        }
      }
    }
  }
  if (!seen) return { center: new THREE.Vector3(0, 0, 0), radius: 20 };

  const center = box.getCenter(new THREE.Vector3());
  const size = box.getSize(new THREE.Vector3());
  return { center, radius: Math.max(size.x, size.y, size.z) / 2 };
}

/** One surface of a building, kept separate so it can be picked and textured on its own. */
export interface SurfacePiece {
  index: number;
  kind: SurfaceKind;
  geometry: THREE.BufferGeometry;
}

/**
 * Build one geometry per surface rather than one per kind.
 *
 * Used for the selected building only, merging is what keeps the neighbour draw count
 * sane, but an individual wall cannot be clicked unless it is its own object.
 *
 * Roofs get orthophoto UVs, which are a function of (x, y) alone. Nothing else gets a UV
 * attribute: there is no image to put on a wall yet, and a UV that means nothing is worse
 * than none at all.
 */
export function surfaceGeometries(
  mesh: MeshDto,
  offset: [number, number, number] = [0, 0, 0],
  orthoBBox?: readonly [number, number, number, number],
): SurfacePiece[] {
  return mesh.surfaces.map((surface, index) => {
    const positions: number[] = [];
    const uvs: number[] = [];
    const uvBox = surface.kind === "roof" ? orthoBBox : undefined;

    for (const ring of surface.rings) {
      if (ring.length < 12) continue;
      const tri = triangulatePolygon({ exterior: ring, interiors: [] });
      for (const [lx, ly, lz] of triangleCorners(tri)) {
        positions.push(lx + offset[0], lz + offset[2], -(ly + offset[1]));

        if (uvBox) {
          const [u, v] = orthoUv(lx + mesh.origin[0], ly + mesh.origin[1], uvBox);
          uvs.push(u, v);
        }
      }
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
    if (uvs.length * 3 === positions.length * 2) {
      geometry.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
    }
    geometry.computeVertexNormals();
    return { index, kind: surface.kind, geometry };
  });
}
