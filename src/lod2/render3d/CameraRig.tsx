import type * as THREE from "three";
import { OrbitControls } from "@react-three/drei";
import { useThree } from "@react-three/fiber";
import { useEffect, useRef } from "react";

/** Metres of surroundings to keep in frame beyond the building itself. */
const SURROUNDINGS_M = 35;

/**
 * Frames the camera on the selected building's actual bounds.
 *
 * Guessing a radius from the first part alone mis-frames multi-part buildings and
 * anything tall, so the box is measured from the geometry that will be drawn.
 */
export function CameraRig({ focus }: { focus: { center: THREE.Vector3; radius: number } }) {
  const { camera } = useThree();
  const controls = useRef<React.ComponentRef<typeof OrbitControls>>(null);
  const key = `${focus.center.toArray().join()}|${focus.radius}`;

  useEffect(() => {
    const cam = camera as THREE.PerspectiveCamera;
    // Fit the bounding sphere to whichever frustum dimension is tighter. The 3D pane is
    // wide and short, so the vertical field of view usually governs, and a distance derived
    // from radius alone clips tall buildings.
    //
    // Framed on the building *plus* a fixed band of its surroundings rather than on the
    // building alone. A bare multiple of the building's own radius makes a terraced house
    // fill the view and a factory sit in emptiness; a fixed band shows roughly the same
    // amount of street either way, which is what makes the context worth loading at all.
    const halfFov = (cam.fov * Math.PI) / 360;
    const framed = focus.radius + SURROUNDINGS_M;
    const distV = framed / Math.tan(halfFov);
    const distH = framed / (Math.tan(halfFov) * Math.max(cam.aspect, 0.1));
    const d = Math.max(distV, distH, 12) * 1.05;

    // A steeper default than a plain 45 degrees. Now that neighbours are substantial
    // rather than ghostly, a low angle puts whichever of them stands between camera and
    // subject straight across the view; looking further down keeps the selected building
    // clear while still showing enough elevation to read wall heights and roof form.
    camera.position.set(
      focus.center.x + d * 0.5,
      focus.center.y + d * 0.82,
      focus.center.z + d * 0.5,
    );
    camera.lookAt(focus.center);
    controls.current?.target.copy(focus.center);
    controls.current?.update();
    // `key` is `focus` by value: a new object with the same centre and radius must not
    // reframe the camera and throw away where the user has orbited to.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, camera]);

  return (
    <OrbitControls
      ref={controls}
      enableDamping
      dampingFactor={0.12}
      maxPolarAngle={Math.PI / 2.05}
      minDistance={2}
      maxDistance={Math.max(focus.radius * 12, 200)}
    />
  );
}

/** North arrow. Source data is UTM, so this is grid north, not true north. */
export function NorthArrow({ radius }: { radius: number }) {
  const r = radius * 1.25;
  return (
    <group position={[0, 0.05, 0]}>
      <mesh position={[0, 0, -r]} rotation={[Math.PI / 2, 0, 0]}>
        <coneGeometry args={[radius * 0.06, radius * 0.18, 12]} />
        <meshBasicMaterial color="#dc2626" />
      </mesh>
    </group>
  );
}
