import { Grid } from "@react-three/drei";
import { Canvas } from "@react-three/fiber";
import { useMemo } from "react";
import { useT } from "@/i18n/useT";
import { apiUrl } from "../api/client.ts";
import { Spinner } from "../components/CustomButton.tsx";
import { useStore } from "../state/store.ts";
import { NeighbourMeshes, SelectionOutline, SurfaceMeshes } from "./BuildingMeshes.tsx";
import { CameraRig, NorthArrow } from "./CameraRig.tsx";
import { SceneMessage, SceneProgress, SelectedWallCaption } from "./SceneOverlays.tsx";
import { TerrainSurface } from "./TerrainSurface.tsx";
import { focusOf } from "./geometry.ts";
import { BACKGROUND, NEIGHBOUR_BRIGHTNESS } from "./materials.ts";
import { useOrthoTexture } from "./useOrthoTexture.ts";
import { useSceneContext } from "./useSceneContext.ts";

/**
 * The 3D view of the selected building: the model, its roof imagery, the ground and the
 * surroundings, plus the overlays that say what is still loading and which wall is picked.
 */
export function Scene() {
  const t = useT();
  const detail = useStore((s) => s.building);
  const editorOpen = useStore((s) => s.photoEditorOpen);
  const neighbours = useStore((s) => s.neighbours);
  const loading = useStore((s) => s.loadingBuilding);
  const loadingNeighbours = useStore((s) => s.loadingNeighbours);
  const showAerial = useStore((s) => s.showAerial);

  const ortho = detail?.orthophoto ?? null;
  const { texture: roofTexture, loading: roofLoading } = useOrthoTexture(
    showAerial && ortho ? apiUrl(ortho.roof.url) : null,
  );
  // One load, shared by the ground plane and every neighbour roof.
  const { texture: contextTexture, loading: contextLoading } = useOrthoTexture(
    showAerial && ortho ? apiUrl(ortho.context.url) : null,
  );
  const contextBBox = showAerial && ortho ? ortho.context.bbox : undefined;
  const uvBBox = showAerial && ortho ? ortho.roof.bbox : undefined;

  const focus = useMemo(
    () => focusOf(detail?.parts.map((p) => p.mesh).filter((m) => m !== null) ?? []),
    [detail],
  );
  const radius = focus.radius;

  const base = useMemo<[number, number, number]>(
    () => detail?.parts.find((p) => p.mesh)?.mesh?.origin ?? [0, 0, 0],
    [detail],
  );

  const groundZ = useMemo(
    () => detail?.parts.find((p) => p.groundZ !== null)?.groundZ ?? null,
    [detail],
  );

  // Above the early returns, because hooks cannot be called conditionally. It does nothing
  // until there is a building and a context extent to build against.
  const { context, building: buildingContext } = useSceneContext({
    detail,
    neighbours,
    contextBBox,
    base,
    groundZ,
  });

  if (!detail) {
    return loading ? (
      <SceneMessage>
        <Spinner /> {t("lod2.loadingBuilding")}
      </SceneMessage>
    ) : (
      <SceneMessage>{t("lod2.selectBuilding")}</SceneMessage>
    );
  }
  if (!detail.parts.some((p) => p.mesh)) {
    return <SceneMessage>{t("lod2.noGeometry")}</SceneMessage>;
  }

  return (
    <>
      {/* `flat` turns tone mapping off. The default is ACES filmic, which is built for
          rendered HDR and visibly darkens and desaturates mid-tones, and the ground plane
          already opted out of it, so identical imagery came out darker on a roof than on the
          ground beside it. That difference is the "grey film over the buildings". */}
      {/* The photo editor covers the whole window. Rendering thousands of surfaces
          behind it at 60 frames a second only takes time from the editor, so the loop
          stops while it is open. */}
      <Canvas
        flat
        shadows
        camera={{ fov: 45, near: 0.1, far: 4000 }}
        dpr={[1, 2]}
        frameloop={editorOpen ? "never" : "always"}
      >
        <color attach="background" args={[BACKGROUND]} />
        {/*
          One regime, because the lights no longer touch any imagery.
        
          An orthophoto already contains the sun that took it; relighting it can only be wrong,
          and in three's physically-correct units (where a light's intensity is divided by π
          before it reaches a diffuse surface) the old intensities were reproducing the imagery
          at roughly half its own brightness. Imagery is now displayed unlit and exactly, and
          these lights exist solely to give the untextured geometry its shape.
        
          Sized so a sunlit face lands near the material's own colour rather than above it:
          (2.0 + 1.3) / π ≈ 1.05, with a face turned away from the sun at about 0.6.
        */}
        {/*
          The ground half of the hemisphere is what lights every wall facing away from the sun,
          and at mid-grey it made those walls read as slate rather than as render in shade,
          the other half of the "grey film". A pale, slightly cool bounce is both closer to a
          real overcast day and much easier to look at.
        */}
        <hemisphereLight args={["#ffffff", "#c8d0d9", 2.0]} />
        {/* Fixed light direction so roof orientation reads consistently between buildings. */}
        <directionalLight
          position={[radius * 2, radius * 3, radius * 1.5]}
          intensity={1.3}
          castShadow
        />
        {showAerial && ortho && context ? (
          <TerrainSurface mesh={context.terrain} texture={contextTexture} />
        ) : showAerial && ortho ? null : (
          <Grid
            args={[radius * 8, radius * 8]}
            cellSize={1}
            sectionSize={10}
            cellColor="#c4c6bd"
            sectionColor="#a9aba2"
            fadeDistance={radius * 10}
            infiniteGrid
            position={[0, -0.02, 0]}
          />
        )}
        <NorthArrow radius={radius} />
        <SurfaceMeshes detail={detail} roofTexture={roofTexture} uvBBox={uvBBox} />
        <SelectionOutline detail={detail} base={base} />
        {context && (
          <NeighbourMeshes
            geometries={context.neighbourGeometries}
            roofTexture={contextTexture}
            brightness={NEIGHBOUR_BRIGHTNESS}
          />
        )}
        <CameraRig focus={focus} />
      </Canvas>
      <SceneProgress
        context={loadingNeighbours || buildingContext}
        imagery={roofLoading || contextLoading}
        neighbourCount={neighbours.length}
      />
      <SelectedWallCaption />
    </>
  );
}
