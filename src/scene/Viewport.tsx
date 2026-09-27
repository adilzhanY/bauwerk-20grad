import { useMemo } from "react";
import { Canvas, useThree } from "@react-three/fiber";
import { GizmoHelper, GizmoViewport, OrbitControls, OrthographicCamera } from "@react-three/drei";
import { Object3D } from "three";
import { bounds } from "@/geometry/polygon";
import { planCamera } from "./planView";
import { Dimensions } from "./Dimensions";
import { PlanDrawing } from "./PlanDrawing";
import { Underlay } from "./Underlay";
import { MapUnderlay } from "./MapUnderlay";
import { ThermalBridges } from "./ThermalBridges";
import { Roof } from "./Roof";
import { ProposalOverlay } from "./ProposalOverlay";
import { HeatPumps } from "./Hvac";
import { Sun } from "./Sun";
import { SectionCut } from "./SectionCut";
import { Walkthrough } from "./Walkthrough";
import { FrameProbe } from "./FrameProbe";
import { storeyDisplay } from "./display";
import type { RenderSample } from "./FrameProbe";
import { UValueBands } from "./UValueBand";
import { useEditorStore } from "@/store/building";
import { Camera } from "./Camera";
import { Grid } from "./Grid";
import { Storey } from "./Storey";
import { Ground } from "./Ground";
import { RemoteCursors, ShareCursor } from "./RemoteCursors";
import { FacadePhotos } from "./FacadePhotos";
import { PLAN_MIRROR } from "./three";
import { Tools } from "./tools/Tools";
import { Compass } from "./Compass";
import { FacadeLines } from "./FacadeLines";
import { BuildingName } from "./BuildingName";
import { storeyElevation } from "@/store/selectors";
import { colors } from "@/lib/colors";

interface ViewportProps {
  onSample?: (s: RenderSample) => void;
}

/** Room around the footprint for the plan's dimension lines, metres. */
const PLAN_MARGIN = 0.5;
/**
 * The tool card, the storeys and the minimap at the left and the view switch at the top cover
 * this much, px, plus 80 px on every side for the dimension lines.
 */
const PLAN_INSETS = { left: 272 + 80, right: 24 + 80, top: 72 + 80, bottom: 24 + 80 };

/** The axis gizmo's distance from the bottom right corner, px. */
const GIZMO_BOTTOM = 76;
const GIZMO_SIDE = 72;

export function Viewport({ onSample }: ViewportProps = {}) {
  const building = useEditorStore((s) => s.building);
  const activeStoreyId = useEditorStore((s) => s.activeStoreyId);
  const isPlanView = useEditorStore((s) => s.planView);
  const sunEnabled = useEditorStore((s) => s.sun.enabled);
  const walking = useEditorStore((s) => s.walkthrough);
  const otherStoreys = useEditorStore((s) => s.otherStoreys);
  const activeElevation = activeStoreyId ? storeyElevation(building, activeStoreyId) : 0;
  const footprintBounds = useMemo(() => bounds(building.footprint), [building.footprint]);

  return (
    <Canvas
      shadows
      dpr={[1, 2]}
      camera={{ position: [18, 14, -18], fov: 45, near: 0.1, far: 500 }}
      gl={{ antialias: true, preserveDrawingBuffer: false }}
      style={{ background: "transparent" }}
    >
      <hemisphereLight args={["#eef1f7", "#7d838c", 1.25]} />
      {/* World space: the camera, the pointer, the renderer's clipping (three.ts). */}
      <SectionCut />
      <Walkthrough />
      {isPlanView && <PlanViewCamera bounds={footprintBounds} elevation={activeElevation} />}
      <ShareCursor />
      {/* Everything drawn is built in plan space; this group turns it into world space. */}
      <group scale={PLAN_MIRROR}>
        <Sun />
        <DefaultDirectionalLight bounds={footprintBounds} intensity={sunEnabled ? 0.25 : 1.6} />
        <Ground />
        <Grid />
        <MapUnderlay />
        <Underlay />
        <ProposalOverlay />
        <UValueBands />
        <ThermalBridges />
        {!isPlanView && <Roof />}
        <HeatPumps />
        <Dimensions />
        {isPlanView && <PlanDrawing />}
        {building.storeys
          .filter((storey) => !isPlanView || storey.id === activeStoreyId)
          .filter(
            (storey) =>
              storeyDisplay(building, storey.id, activeStoreyId, otherStoreys) !== "hidden",
          )
          .map((storey) => (
            <Storey
              key={storey.id}
              building={building}
              storey={storey}
              elevation={storeyElevation(building, storey.id)}
              active={storey.id === activeStoreyId}
              display={storeyDisplay(building, storey.id, activeStoreyId, otherStoreys)}
              ghostOpacity={otherStoreys.ghostOpacity}
            />
          ))}
        {!isPlanView && <FacadeLines />}
        <FacadePhotos />
        <Compass />
        <BuildingName />
        <RemoteCursors />
        <Tools />
      </group>
      {!walking && !isPlanView && (
        <OrbitControls
          makeDefault
          enableDamping
          dampingFactor={0.12}
          minDistance={2}
          maxDistance={150}
          maxPolarAngle={Math.PI / 2 - 0.03}
          mouseButtons={{ LEFT: 0, MIDDLE: 1, RIGHT: 2 }}
        />
      )}
      <Camera />
      {!isPlanView && !walking && (
        <GizmoHelper alignment="bottom-right" margin={[GIZMO_SIDE, GIZMO_BOTTOM]}>
          <GizmoViewport
            axisColors={[colors.muted, colors.muted, colors.muted]}
            labelColor="#ffffff"
            axisHeadScale={0.9}
          />
        </GizmoHelper>
      )}
      {onSample && <FrameProbe onSample={onSample} />}
    </Canvas>
  );
}

function PlanViewCamera({
  bounds: footprintBounds,
  elevation,
}: {
  bounds: ReturnType<typeof bounds>;
  elevation: number;
}) {
  const size = useThree((state) => state.size);
  const plan = useMemo(
    () =>
      planCamera(
        footprintBounds,
        { width: size.width, height: size.height },
        elevation,
        PLAN_MARGIN,
        PLAN_INSETS,
      ),
    [footprintBounds, size.width, size.height, elevation],
  );
  return (
    <>
      <OrthographicCamera
        makeDefault
        position={plan.position}
        zoom={plan.zoom}
        up={[0, 0, -1]}
        near={0.1}
        far={200}
      />
      <OrbitControls
        makeDefault
        enableRotate={false}
        target={plan.target}
        enableDamping
        dampingFactor={0.12}
        minDistance={2}
        maxDistance={150}
        mouseButtons={{ LEFT: 0, MIDDLE: 1, RIGHT: 2 }}
      />
    </>
  );
}

function DefaultDirectionalLight({
  bounds: footprintBounds,
  intensity,
}: {
  bounds: ReturnType<typeof bounds>;
  intensity: number;
}) {
  const target = useMemo(() => new Object3D(), []);
  const centre: [number, number, number] = [
    (footprintBounds.min.x + footprintBounds.max.x) / 2,
    0,
    (footprintBounds.min.y + footprintBounds.max.y) / 2,
  ];
  return (
    <>
      <primitive object={target} position={centre} />
      <directionalLight
        position={[centre[0] + 20, 30, centre[2] + 10]}
        target={target}
        intensity={intensity}
        castShadow
        shadow-mapSize={[2048, 2048]}
        shadow-camera-left={-40}
        shadow-camera-right={40}
        shadow-camera-top={40}
        shadow-camera-bottom={-40}
      />
    </>
  );
}
