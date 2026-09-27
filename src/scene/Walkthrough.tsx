import { useEffect, useMemo, useRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import { PointerLockControls } from "@react-three/drei";
import { Vector3 } from "three";
import { planToWorld, worldToPlan } from "./three";
import { effectiveWallThickness } from "@/geometry/layers";
import { bounds, centroid } from "@/geometry/polygon";
import { useEditorStore } from "@/store/building";
import { selectActiveStorey, storeyElevation } from "@/store/selectors";
import { EYE_HEIGHT, constrainWalk } from "./walk";

const SPEED = 2.2; // m/s

/** First person camera at eye height on the active storey. WASD or arrows move, the mouse looks. */
export function Walkthrough() {
  const get = useThree((s) => s.get);
  const building = useEditorStore((s) => s.building);
  const storey = useEditorStore(selectActiveStorey);
  const walking = useEditorStore((s) => s.walkthrough);
  const keys = useRef(new Set<string>());
  const placed = useRef(false);
  const direction = useRef(new Vector3());
  const right = useRef(new Vector3());
  const footprintBounds = useMemo(() => bounds(building.footprint), [building.footprint]);
  const thickness = effectiveWallThickness(building);

  useEffect(() => {
    const pressed = keys.current;
    if (!walking) return;
    const down = (e: KeyboardEvent) => {
      pressed.add(e.key.toLowerCase());
    };
    const up = (e: KeyboardEvent) => {
      pressed.delete(e.key.toLowerCase());
    };
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
      pressed.clear();
    };
  }, [walking]);

  useFrame((_, dt) => {
    const camera = get().camera;
    if (!walking) {
      placed.current = false;
      return;
    }
    if (!storey) return;
    const elevation = storeyElevation(building, storey.id);
    if (!placed.current) {
      const c = centroid(building.footprint);
      camera.position.copy(planToWorld(c, elevation + EYE_HEIGHT));
      placed.current = true;
    }
    const k = keys.current;
    const forward =
      (k.has("w") || k.has("arrowup") ? 1 : 0) - (k.has("s") || k.has("arrowdown") ? 1 : 0);
    const strafe =
      (k.has("d") || k.has("arrowright") ? 1 : 0) - (k.has("a") || k.has("arrowleft") ? 1 : 0);
    if (forward === 0 && strafe === 0) {
      camera.position.y = elevation + EYE_HEIGHT;
      return;
    }
    const dir = direction.current;
    camera.getWorldDirection(dir);
    dir.y = 0;
    dir.normalize();
    right.current.set(-dir.z, 0, dir.x);
    const step = Math.min(dt, 0.05) * SPEED;
    // The step is taken in world space and brought into the plan, where the walls are.
    const from = worldToPlan(camera.position);
    const to = worldToPlan({
      x: camera.position.x + (dir.x * forward + right.current.x * strafe) * step,
      z: camera.position.z + (dir.z * forward + right.current.z * strafe) * step,
    });
    const { min, max } = footprintBounds;
    const clamped = {
      x: Math.min(max.x + 3, Math.max(min.x - 3, to.x)),
      y: Math.min(max.y + 3, Math.max(min.y - 3, to.y)),
    };
    const p = constrainWalk(building, storey, from, clamped, thickness);
    camera.position.copy(planToWorld(p, elevation + EYE_HEIGHT));
  });

  if (!walking) return null;
  return <PointerLockControls makeDefault selector="#walk-lock" />;
}
