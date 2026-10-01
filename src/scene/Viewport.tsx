import { useMemo } from "react";
import { ModelSnapshot } from "./ModelSnapshot";
import { Canvas, useThree } from "@react-three/fiber";
import { OrbitControls, OrthographicCamera } from "@react-three/drei";
import { MOUSE, Object3D } from "three";
import { bounds } from "@/geometry/polygon";
import { planCamera } from "./planView";
import { Dimensions } from "./Dimensions";
import { HoverCursor } from "./HoverCursor";
import { Measurements } from "./Measurements";
import { PlanDrawing } from "./PlanDrawing";
import { Underlay } from "./Underlay";
import { MapUnderlay } from "./MapUnderlay";
import { ThermalBridges } from "./ThermalBridges";
import { Roof } from "./Roof";
import { HeatPumps } from "./Hvac";
import { FrameProbe } from "./FrameProbe";
import { storeyDisplay } from "./display";
import type { RenderSample } from "./FrameProbe";
import { useEditorStore } from "@/store/building";
import { Camera } from "./Camera";
import { FollowCamera } from "./FollowCamera";
import { Grid } from "./Grid";
import { Storey } from "./Storey";
import { Ground } from "./Ground";
import { RemoteCursors, ShareCursor } from "./RemoteCursors";
import { FacadePhotos } from "./FacadePhotos";
import { NotePins } from "./NotePins";
import { PLAN_MIRROR } from "./three";
import { Tools } from "./tools/Tools";
import { Compass } from "./Compass";
import { FacadeLines } from "./FacadeLines";
import { storeyElevation } from "@/store/selectors";

interface ViewportProps {
  onSample?: (s: RenderSample) => void;
}

/** Room around the footprint for the plan's dimension lines, metres. */
const PLAN_MARGIN = 0.5;
/** Plan zoom limits: a share of the zoom that fits the building, and pixels per metre. */
const PLAN_MIN_ZOOM = 0.5;
const PLAN_MAX_PX_PER_METRE = 500;
/**
 * The tool card, the storeys and the minimap at the left and the view switch at the top cover
 * this much, px, plus 80 px on every side for the dimension lines.
 */
const PLAN_INSETS = { left: 272 + 80, right: 24 + 80, top: 72 + 80, bottom: 24 + 80 };

export function Viewport({ onSample }: ViewportProps = {}) {
  const building = useEditorStore((s) => s.building);
  const activeStoreyId = useEditorStore((s) => s.activeStoreyId);
  const isPlanView = useEditorStore((s) => s.planView);
  const otherStoreys = useEditorStore((s) => s.otherStoreys);
  const activeElevation = activeStoreyId ? storeyElevation(building, activeStoreyId) : 0;
  const footprintBounds = useMemo(() => bounds(building.footprint), [building.footprint]);

  return (
    <>
      <Canvas
        dpr={[1, 2]}
        camera={{ position: [18, 14, -18], fov: 45, near: 0.1, far: 500 }}
        gl={{ antialias: true, preserveDrawingBuffer: false }}
        style={{ background: "transparent" }}
      >
        {/* Sky above, light pavement below: faces turned away from the light still get the light
          that bounces off the street, as a facade does, instead of going near black. */}
        <hemisphereLight args={["#f1f4f9", "#b3b8c0", 1.3]} />
        {/* World space: the camera and the pointer (three.ts). */}
        {isPlanView && <PlanViewCamera bounds={footprintBounds} elevation={activeElevation} />}
        <ShareCursor />
        <HoverCursor />
        {/* Everything drawn is built in plan space; this group turns it into world space. */}
        <group scale={PLAN_MIRROR}>
          <DefaultDirectionalLight bounds={footprintBounds} intensity={1.6} />
          <Ground />
          <Grid />
          <MapUnderlay />
          <Underlay />
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
          <NotePins />
          <Measurements />
          <Compass />
          <RemoteCursors />
          <Tools />
        </group>
        {!isPlanView && (
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
        <FollowCamera />
        {onSample && <FrameProbe onSample={onSample} />}
      </Canvas>
      {/* The project card's picture, drawn apart from this view. */}
      <ModelSnapshot />
    </>
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
        // Out to half the fitted size, so the building never shrinks to a speck; in to
        // 500 px per metre, a centimetre as 5 px, enough to place a door exactly.
        minZoom={plan.zoom * PLAN_MIN_ZOOM}
        maxZoom={Math.max(plan.zoom * 2, PLAN_MAX_PX_PER_METRE)}
        // A plan is paper on a table: drag anywhere to slide it, and the wheel zooms into
        // the spot under the pointer. Rotating stays off.
        zoomToCursor
        mouseButtons={{ LEFT: MOUSE.PAN, MIDDLE: MOUSE.DOLLY, RIGHT: MOUSE.PAN }}
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
      />
      {/* A weak fill from the opposite side, so the walls the main light
          does not reach keep their colour and their openings stay readable. */}
      <directionalLight
        position={[centre[0] - 20, 18, centre[2] - 10]}
        target={target}
        intensity={intensity * 0.3}
      />
    </>
  );
}
