import { useEffect, useMemo } from "react";
import { Canvas, useThree } from "@react-three/fiber";
import { pictureView, streetEdge } from "@/geometry/pictureView";
import { buildRoof } from "@/geometry/roof";
import type { Building } from "@/geometry/types";
import { selectTotalHeight, storeyElevation } from "@/store/selectors";
import { useEditorStore } from "@/store/building";
import { PictureMode } from "./hover";
import { Roof } from "./Roof";
import { Storey } from "./Storey";
import { PLAN_MIRROR, planToWorld } from "./three";

/** The picture's size; the card shows it at 4:3 and shrinkImage makes it smaller. */
const WIDTH = 960;
const HEIGHT = 720;
const FOV = 30;

/**
 * The building alone for its project card (TODO, card picture): every storey solid with its
 * walls' colour, windows and roof, from a three-quarter view of the street side that shows all of it. No grid,
 * ground, shadows, map, photos or selection, and no background: the card's own colour shows
 * through, so the picture follows the light or dark theme. Drawn once in a small canvas off
 * the screen, then handed over as a PNG and taken down again.
 */
export function ModelThumbnail({ onPicture }: { onPicture: (blob: Blob | null) => void }) {
  const building = useEditorStore((s) => s.building);
  const top = useEditorStore(selectTotalHeight);
  // The walls with a facade photo: the street side, which the picture looks at.
  const photos = useEditorStore((s) => s.facadePhotos);
  const photoEdges = useMemo(() => Object.keys(photos).map(Number), [photos]);
  const view = useMemo(() => {
    const ridge = building.storeys.length > 0 ? buildRoof(building, top).ridgeHeight : 0;
    const front = streetEdge(building, photoEdges);
    if (front === null) return null;
    return pictureView(building.footprint, front, top + ridge, FOV, WIDTH / HEIGHT);
  }, [building, top, photoEdges]);

  useEffect(() => {
    if (!view) onPicture(null);
  }, [view, onPicture]);
  if (!view) return null;

  const eye = planToWorld(view.eye, view.eye.h);
  const target = planToWorld(view.target, view.target.h);
  return (
    <div
      aria-hidden
      style={{ position: "fixed", left: -10_000, top: 0, width: WIDTH, height: HEIGHT }}
    >
      <Canvas
        dpr={1}
        frameloop="demand"
        gl={{ antialias: true, alpha: true, preserveDrawingBuffer: true }}
        camera={{ position: [eye.x, eye.y, eye.z], fov: FOV, near: 0.1, far: 2000 }}
        onCreated={({ camera }) => {
          camera.lookAt(target);
        }}
      >
        <hemisphereLight args={["#f1f4f9", "#b3b8c0", 1.5]} />
        {/* From behind the camera's left shoulder, so the two sides in view differ. */}
        <directionalLight
          position={[eye.x * 0.6 - eye.z * 0.4, eye.y * 2, eye.z * 0.6 + eye.x * 0.4]}
          intensity={1.4}
        />
        <PictureMode.Provider value>
          <group scale={PLAN_MIRROR}>
            <Building building={building} />
            <Roof />
          </group>
        </PictureMode.Provider>
        <Capture onPicture={onPicture} />
      </Canvas>
    </div>
  );
}

function Building({ building }: { building: Building }) {
  return building.storeys.map((storey) => (
    <Storey
      key={storey.id}
      building={building}
      storey={storey}
      elevation={storeyElevation(building, storey.id)}
      active={false}
      display="solid"
      ghostOpacity={1}
    />
  ));
}

/** Two frames for everything to be built, then one render read straight into a PNG. */
function Capture({ onPicture }: { onPicture: (blob: Blob | null) => void }) {
  const gl = useThree((s) => s.gl);
  const scene = useThree((s) => s.scene);
  const camera = useThree((s) => s.camera);
  useEffect(() => {
    let frame = requestAnimationFrame(() => {
      frame = requestAnimationFrame(() => {
        gl.render(scene, camera);
        gl.domElement.toBlob(onPicture, "image/png");
      });
    });
    return () => {
      cancelAnimationFrame(frame);
    };
  }, [gl, scene, camera, onPicture]);
  return null;
}
