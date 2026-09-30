import { useEffect } from "react";
import { useThree } from "@react-three/fiber";
import { currentProjectRef, savePhoto, shrinkImage } from "@/projects/projects";
import { useEditorStore } from "@/store/building";

/** How long the building has to rest before the view is taken, and the least time between two. */
const REST_MS = 4000;
const EVERY_MS = 30_000;

/**
 * The 3D view as the card picture of a project that has no facade photo yet: rendered and
 * saved a few seconds after the building last changed, at most every half minute, and only
 * while the tab is visible. The frame is taken right after an explicit render, since the
 * drawing buffer is not kept between frames.
 */
export function ModelSnapshot() {
  const building = useEditorStore((s) => s.building);
  const gl = useThree((s) => s.gl);
  const scene = useThree((s) => s.scene);
  const camera = useThree((s) => s.camera);

  useEffect(() => {
    const ref = currentProjectRef();
    if (!ref) return;
    const timer = window.setTimeout(() => {
      if (document.visibilityState !== "visible") return;
      const key = `bauwerk.snapshot.${ref.kind}.${ref.id}`;
      if (Date.now() - Number(sessionStorage.getItem(key) ?? 0) < EVERY_MS) return;
      sessionStorage.setItem(key, String(Date.now()));
      gl.render(scene, camera);
      gl.domElement.toBlob((blob) => {
        if (!blob) return;
        void shrinkImage(blob).then((small) => {
          if (small) void savePhoto(ref, "model", small.blob, small.width, small.height);
        });
      }, "image/png");
    }, REST_MS);
    return () => {
      window.clearTimeout(timer);
    };
  }, [building, gl, scene, camera]);

  return null;
}
