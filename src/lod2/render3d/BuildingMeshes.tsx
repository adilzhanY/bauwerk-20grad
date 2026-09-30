import type { BuildingDetail } from "lod2-core/api";
import type { SurfaceKind } from "lod2-core/types";
import * as THREE from "three";
import { useEffect, useMemo, useState } from "react";
import { useStore } from "../state/store.ts";
import { meshToGeometries, roofPlaneGeometries, surfaceGeometries } from "./geometry.ts";
import { COLORS, NEIGHBOUR_COLORS } from "./materials.ts";
import { useCanvasCursor } from "@/scene/useCanvasCursor";
import { useSceneColors } from "@/scene/useSceneColors";
import { triples } from "./points";

/**
 * Closure surfaces are virtual faces that close a solid where two building parts touch.
 * They are drawn see-through so they never hide the real walls behind them.
 */
const CLOSURE_GLASS = { transparent: true, opacity: 0.35, depthWrite: false };

/** Pointer travel, in screen pixels, above which a press and release is a drag. */
const CLICK_TRAVEL_PX = 4;

/** Above this, a building gets too many pickable objects to be worth it. */
const MAX_PICKABLE_SURFACES = 500;

/**
 * One wall, drawn as its own object so it can be clicked.
 *
 * Clicking sets `selectedWall` in the store and nothing else happens. That is the hook the
 * rest of the app hangs off: the panel reads the selection, and anything that wants to work
 * on a single facade starts from the same place.
 */
function WallMesh({
  piece,
  partGid,
  selected,
}: {
  piece: ReturnType<typeof surfaceGeometries>[number];
  partGid: string;
  selected: boolean;
}) {
  const selectWall = useStore((s) => s.selectWall);
  const [hovered, onHover] = useState(false);
  useCanvasCursor(hovered ? "pointer" : null);

  return (
    <mesh
      geometry={piece.geometry}
      castShadow
      receiveShadow
      onClick={(e) => {
        // Entry point of the whole feature: a click on a wall face records which surface of
        // which building part is selected. The panel and the photo editor read it from the store.
        e.stopPropagation();
        // Orbiting the camera ends with a click too. More than a few pixels of travel between
        // press and release was a drag, not a pick.
        if (e.delta > CLICK_TRAVEL_PX) return;
        selectWall({ partGid, surfaceIndex: piece.index });
      }}
      onPointerOver={(e) => {
        e.stopPropagation();
        onHover(true);
      }}
      onPointerOut={() => {
        onHover(false);
      }}
    >
      <meshStandardMaterial
        color={selected ? "#fde68a" : COLORS[piece.kind]}
        roughness={0.85}
        metalness={0}
        emissive={selected ? "#f59e0b" : "#000000"}
        emissiveIntensity={selected ? 0.18 : 0}
      />
    </mesh>
  );
}

/**
 * The selected building's surfaces: clickable walls, textured roofs, and see-through
 * closures. A very large building is drawn merged by kind, which is fast but not clickable.
 */
export function SurfaceMeshes({
  detail,
  roofTexture,
  uvBBox,
}: {
  detail: BuildingDetail;
  roofTexture: THREE.Texture | null;
  uvBBox?: readonly [number, number, number, number];
}) {
  const highlighted = useStore((s) => s.highlightedPlane);
  const selectedWall = useStore((s) => s.selectedWall);

  const { parts, planes, tooManySurfaces } = useMemo(() => {
    const withMesh = detail.parts.flatMap((p) => (p.mesh ? [{ gid: p.gid, mesh: p.mesh }] : []));
    const firstPart = withMesh[0];
    if (!firstPart) return { parts: [], planes: [], tooManySurfaces: false };

    // All parts of one building share a coordinate frame; rebase them onto the first
    // part's origin so a multi-part building assembles correctly instead of stacking.
    const first = firstPart.mesh.origin;
    const total = withMesh.reduce((n, p) => n + p.mesh.surfaces.length, 0);
    // A handful of buildings in the data have thousands of surfaces. One object each
    // would be a pickable-mesh explosion, so those fall back to merged drawing.
    const tooMany = total > MAX_PICKABLE_SURFACES;

    const parts = withMesh.map((p) => {
      const o = p.mesh.origin;
      const offset: [number, number, number] = [o[0] - first[0], o[1] - first[1], o[2] - first[2]];
      return {
        gid: p.gid,
        pieces: tooMany ? [] : surfaceGeometries(p.mesh, offset, uvBBox),
        merged: tooMany ? [...meshToGeometries(p.mesh, offset, uvBBox)] : [],
      };
    });

    const planes = withMesh.flatMap((p) => {
      const o = p.mesh.origin;
      return roofPlaneGeometries(p.mesh).map((g, idx) => {
        g.translate(o[0] - first[0], o[2] - first[2], -(o[1] - first[1]));
        return { gid: p.gid, idx, geometry: g };
      });
    });

    return { parts, planes, tooManySurfaces: tooMany };
  }, [detail, uvBBox]);

  useEffect(
    () => () => {
      for (const part of parts) {
        for (const piece of part.pieces) piece.geometry.dispose();
        for (const [, g] of part.merged) g.dispose();
      }
      for (const p of planes) p.geometry.dispose();
    },
    [parts, planes],
  );

  return (
    <group>
      {parts.map((part) =>
        tooManySurfaces
          ? part.merged.map(([kind, geometry]) => (
              <mesh key={`${part.gid}-${kind}`} geometry={geometry} castShadow receiveShadow>
                {kind === "roof" && roofTexture ? (
                  <meshBasicMaterial map={roofTexture} />
                ) : (
                  <meshStandardMaterial
                    color={COLORS[kind]}
                    roughness={0.85}
                    metalness={0}
                    {...(kind === "closure" ? CLOSURE_GLASS : {})}
                  />
                )}
              </mesh>
            ))
          : part.pieces.map((piece) => {
              const isSelected =
                selectedWall?.partGid === part.gid && selectedWall.surfaceIndex === piece.index;

              if (piece.kind === "roof") {
                return (
                  <mesh
                    key={`${part.gid}-${piece.index}`}
                    geometry={piece.geometry}
                    castShadow
                    receiveShadow
                  >
                    {roofTexture ? (
                      <meshBasicMaterial map={roofTexture} />
                    ) : (
                      <meshStandardMaterial color={COLORS.roof} roughness={0.85} metalness={0} />
                    )}
                  </mesh>
                );
              }
              if (piece.kind === "closure") {
                return (
                  <mesh key={`${part.gid}-${piece.index}`} geometry={piece.geometry}>
                    <meshStandardMaterial color={COLORS.closure} {...CLOSURE_GLASS} />
                  </mesh>
                );
              }
              return (
                <WallMesh
                  key={`${part.gid}-${piece.index}`}
                  piece={piece}
                  partGid={part.gid}
                  selected={isSelected}
                />
              );
            }),
      )}

      {planes
        .filter((p) => p.gid === highlighted?.gid && p.idx === highlighted.idx)
        .map((p) => (
          <mesh key={`hl-${p.gid}-${p.idx}`} geometry={p.geometry}>
            <meshStandardMaterial color="#facc15" emissive="#facc15" emissiveIntensity={0.5} />
          </mesh>
        ))}
    </group>
  );
}

/**
 * Outline of the selected building's footprint, drawn at ground level.
 *
 * Neighbour roofs carry the same orthophoto, so every roof in the scene is continuous imagery and
 * the selection is otherwise impossible to pick out, especially looking straight down.
 * A footprint line reads from any camera angle, and matches the selection colour on the
 * 2D map so the two views agree.
 */
export function SelectionOutline({
  detail,
  base,
}: {
  detail: BuildingDetail;
  base: [number, number, number];
}) {
  const geometries = useMemo(() => {
    const out: THREE.BufferGeometry[] = [];
    for (const part of detail.parts) {
      if (!part.mesh) continue;
      const o = part.mesh.origin;
      for (const surface of part.mesh.surfaces) {
        if (surface.kind !== "ground") continue;
        for (const ring of surface.rings) {
          if (ring.length < 12) continue;
          const pts: number[] = [];
          // Drop the repeated closing vertex: lineLoop closes the ring itself.
          for (const [x, y, z] of triples(ring, ring.length - 3)) {
            // Z-up source -> Y-up three.js, lifted clear of the ground plane.
            pts.push(x + o[0] - base[0], z + o[2] - base[2] + 0.12, -(y + o[1] - base[1]));
          }
          const g = new THREE.BufferGeometry();
          g.setAttribute("position", new THREE.Float32BufferAttribute(pts, 3));
          out.push(g);
        }
      }
    }
    return out;
  }, [detail, base]);

  useEffect(
    () => () => {
      for (const g of geometries) g.dispose();
    },
    [geometries],
  );

  return (
    <group>
      {geometries.map((geometry, i) => (
        <lineLoop key={i} geometry={geometry} renderOrder={3}>
          <lineBasicMaterial color="#f43f5e" depthTest={false} transparent opacity={0.95} />
        </lineLoop>
      ))}
    </group>
  );
}

/**
 * Surrounding buildings, for context.
 *
 * Their roofs are draped with the same wide context image the ground plane uses, because the
 * selected building's own crop is too tight to reach them, so no extra request is made
 * and the neighbours' roofs line up with the ground they sit on.
 */
export function NeighbourMeshes({
  geometries,
  roofTexture,
  brightness,
}: {
  /** Prebuilt and owned by `useSceneContext`, one merged buffer per surface kind. */
  geometries: [SurfaceKind, THREE.BufferGeometry][];
  roofTexture: THREE.Texture | null;
  brightness: number;
}) {
  // Two ways of saying "behind", because multiplying does the wrong thing to a flat colour.
  //
  // On draped imagery, a grey multiplier reads as slight shade and the picture survives. On an
  // already mid-grey wall it just makes it dark, and several hundred of them turn the scene
  // into a slab of slate, which is what a grey film over the model actually was. Blending
  // toward the scene background instead is how distance looks: lighter and hazier, still
  // plainly secondary to the selection.
  // The background of the current theme, so neighbours recede into black in the dark theme too.
  const background = useSceneColors().siteBg;
  const dim = new THREE.Color(brightness, brightness, brightness);
  const haze = (hex: string) =>
    new THREE.Color(hex).lerp(new THREE.Color(background), 1 - brightness);

  return (
    <group>
      {geometries.map(([kind, geometry]) => (
        <mesh key={kind} geometry={geometry} castShadow receiveShadow>
          {kind === "roof" && roofTexture ? (
            <meshBasicMaterial key={roofTexture.uuid} map={roofTexture} color={dim} />
          ) : (
            <meshStandardMaterial
              color={haze(NEIGHBOUR_COLORS[kind])}
              roughness={0.9}
              metalness={0}
            />
          )}
        </mesh>
      ))}
    </group>
  );
}
