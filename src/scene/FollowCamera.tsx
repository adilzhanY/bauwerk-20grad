import { useEffect, useRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import { OrthographicCamera, Vector3 } from "three";
import type { OrbitControls as OrbitControlsImpl } from "three-stdlib";
import { shareView, watchViews } from "@/sync/presence";
import type { SharedView } from "@/sync/presence";
import { useEditorStore } from "@/store/building";
import { followView, shouldShare } from "./follow";
import type { Sent } from "./follow";

/** How much of the way to the followed camera each frame covers: a short glide, not a jump. */
const EASE = 0.2;

/**
 * Follow mode (TODO Part 21, CC.5). Every tab shares its view while others are in the
 * project: camera, storey, and whether it is the 2D plan (with its zoom) or the 3D view.
 * Following someone takes over their storey and view mode, glides this camera to theirs and
 * keeps it there. Any own move of the view, or Escape, stops following. Following moves only
 * the view, never the building.
 */
export function FollowCamera() {
  const controls = useThree((s) => {
    const c = s.controls as OrbitControlsImpl | null;
    return c != null && "target" in c && c.target instanceof Vector3 ? c : null;
  });
  const following = useEditorStore((s) => s.following);
  const goal = useRef<SharedView | null>(null);
  const sent = useRef<Sent>({ view: null, at: 0 });

  // Theirs, as it arrives.
  useEffect(() => {
    goal.current = null;
    if (!following) return;
    return watchViews((clientId, view) => {
      if (clientId !== following) return;
      goal.current = view;
      followView(view);
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

  useFrame(({ camera }) => {
    if (!controls) return;
    const ortho = camera instanceof OrthographicCamera;
    const view = goal.current;
    if (following && view) {
      // Until the switch to their view mode has given this tab the same kind of camera.
      if ((view.plan === true) !== ortho) return;
      camera.position.lerp(new Vector3(...view.position), EASE);
      controls.target.lerp(new Vector3(...view.target), EASE);
      if (ortho && view.zoom) {
        camera.zoom += (view.zoom - camera.zoom) * EASE;
        camera.updateProjectionMatrix();
      }
      controls.update();
      return;
    }
    // Ours, for the others: when it changed, and once a second for anyone who just started
    // following.
    const state = useEditorStore.getState();
    const mine: SharedView = {
      position: camera.position.toArray(),
      target: controls.target.toArray(),
      storeyId: state.activeStoreyId,
      plan: state.planView,
      zoom: ortho ? camera.zoom : null,
    };
    const now = performance.now();
    if (!shouldShare(sent.current, mine, now)) return;
    sent.current = { view: mine, at: now };
    shareView(mine);
  });

  return null;
}
