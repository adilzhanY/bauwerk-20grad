import { useEffect, useRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import { Vector3 } from "three";
import type { OrbitControls as OrbitControlsImpl } from "three-stdlib";
import { shareView, watchViews } from "@/sync/presence";
import type { SharedView } from "@/sync/presence";
import { useEditorStore } from "@/store/building";

/** How much of the way to the followed camera each frame covers: a short glide, not a jump. */
const EASE = 0.2;
/** Camera changes smaller than this (metres) are not sent. */
const MOVED = 0.01;

/**
 * Follow mode (TODO Part 21, CC.5). Every tab shares its camera while others are in the
 * project; following someone glides this view to theirs and onto their storey, and keeps it
 * there. Any own move of the view, or Escape, stops following. Following moves only the
 * camera, never the building.
 */
export function FollowCamera() {
  const camera = useThree((s) => s.camera);
  const controls = useThree((s) => {
    const c = s.controls as OrbitControlsImpl | null;
    return c != null && "target" in c && c.target instanceof Vector3 ? c : null;
  });
  const following = useEditorStore((s) => s.following);
  const goal = useRef<SharedView | null>(null);
  const sent = useRef({ position: new Vector3(), target: new Vector3() });

  // Theirs, as it arrives.
  useEffect(() => {
    goal.current = null;
    if (!following) return;
    return watchViews((clientId, view) => {
      if (clientId !== following) return;
      goal.current = view;
      const store = useEditorStore.getState();
      if (view.storeyId && view.storeyId !== store.activeStoreyId)
        store.setActiveStorey(view.storeyId);
    });
  }, [following]);

  // An own move of the view, or Escape, ends following; so does the followed tab leaving.
  useEffect(() => {
    if (!following) return;
    const stop = () => {
      useEditorStore.getState().setFollowing(null);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") stop();
    };
    controls?.addEventListener("start", stop);
    window.addEventListener("keydown", onKey);
    const offPresence = useEditorStore.subscribe((state) => {
      if (!state.presence.some((p) => p.clientId === following)) stop();
    });
    return () => {
      controls?.removeEventListener("start", stop);
      window.removeEventListener("keydown", onKey);
      offPresence();
    };
  }, [following, controls]);

  useFrame(() => {
    if (!controls) return;
    const view = goal.current;
    if (following && view) {
      camera.position.lerp(new Vector3(...view.position), EASE);
      controls.target.lerp(new Vector3(...view.target), EASE);
      controls.update();
      return;
    }
    // Ours, for the others: only when it moved.
    const last = sent.current;
    if (
      last.position.distanceTo(camera.position) < MOVED &&
      last.target.distanceTo(controls.target) < MOVED
    )
      return;
    last.position.copy(camera.position);
    last.target.copy(controls.target);
    shareView({
      position: camera.position.toArray(),
      target: controls.target.toArray(),
      storeyId: useEditorStore.getState().activeStoreyId,
    });
  });

  return null;
}
