import { useEffect } from "react";
import { useThree } from "@react-three/fiber";
import { Html } from "@react-three/drei";
import { Plane, Vector2, Vector3 } from "three";
import { useEditorStore } from "@/store/building";
import { shareCursor } from "@/sync/presence";
import { worldToPlan } from "./three";

const GROUND = new Plane(new Vector3(0, 1, 0), 0);

/**
 * Reports where this tab's pointer meets the ground, as a plan point, to the others
 * in a shared project. Without a shared project the report goes nowhere.
 */
export function ShareCursor() {
  const gl = useThree((s) => s.gl);
  const camera = useThree((s) => s.camera);
  const raycaster = useThree((s) => s.raycaster);

  useEffect(() => {
    const element = gl.domElement;
    const ndc = new Vector2();
    const hit = new Vector3();
    const onMove = (event: PointerEvent) => {
      const rect = element.getBoundingClientRect();
      ndc.set(
        ((event.clientX - rect.left) / rect.width) * 2 - 1,
        -((event.clientY - rect.top) / rect.height) * 2 + 1,
      );
      raycaster.setFromCamera(ndc, camera);
      if (raycaster.ray.intersectPlane(GROUND, hit)) shareCursor(worldToPlan(hit));
    };
    const onLeave = () => {
      shareCursor(null);
    };
    element.addEventListener("pointermove", onMove);
    element.addEventListener("pointerleave", onLeave);
    return () => {
      element.removeEventListener("pointermove", onMove);
      element.removeEventListener("pointerleave", onLeave);
    };
  }, [gl, camera, raycaster]);

  return null;
}

/** The other people's pointers on the ground: a ring in their colour with their name. */
export function RemoteCursors() {
  const cursors = useEditorStore((s) => s.presence);
  return (
    <>
      {cursors.map((p) =>
        p.cursor ? (
          <group key={p.clientId} position={[p.cursor.x, 0.02, p.cursor.y]}>
            <mesh rotation={[-Math.PI / 2, 0, 0]} renderOrder={10}>
              <ringGeometry args={[0.16, 0.26, 32]} />
              <meshBasicMaterial color={p.color} depthTest={false} transparent />
            </mesh>
            <Html position={[0, 0.25, 0]} center zIndexRange={[20, 0]} pointerEvents="none">
              <span
                className="rounded-control px-1.5 py-0.5 text-xs font-medium whitespace-nowrap text-white shadow-float"
                style={{ background: p.color }}
              >
                {p.actor}
              </span>
            </Html>
          </group>
        ) : null,
      )}
    </>
  );
}
