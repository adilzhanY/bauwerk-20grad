import { useCallback, useEffect, useState } from "react";
import { can } from "@/projects/roles";
import { currentProjectRef, savePhoto, shrinkImage } from "@/projects/projects";
import { useEditorStore } from "@/store/building";
import { ModelThumbnail } from "./ModelThumbnail";

/** How long the building has to rest before the picture is taken, and the least time between two. */
const REST_MS = 4000;
const EVERY_MS = 30_000;

/**
 * The building as the picture of its project card: drawn on its own (ModelThumbnail) a few
 * seconds after it last changed, at most every half minute, only while the tab is visible and
 * only by someone who may change the project.
 */
export function ModelSnapshot() {
  const building = useEditorStore((s) => s.building);
  const role = useEditorStore((s) => s.projectRole);
  const [taking, setTaking] = useState(false);

  useEffect(() => {
    const ref = currentProjectRef();
    if (!ref || building.storeys.length === 0 || (role && !can(role, "edit"))) return;
    const timer = window.setTimeout(() => {
      if (document.visibilityState !== "visible") return;
      const key = `bauwerk.snapshot.${ref.kind}.${ref.id}`;
      if (Date.now() - Number(sessionStorage.getItem(key) ?? 0) < EVERY_MS) return;
      sessionStorage.setItem(key, String(Date.now()));
      setTaking(true);
    }, REST_MS);
    return () => {
      window.clearTimeout(timer);
    };
  }, [building, role]);

  const onPicture = useCallback((blob: Blob | null) => {
    setTaking(false);
    const ref = currentProjectRef();
    if (!blob || !ref) return;
    void shrinkImage(blob, 480, "image/webp").then((small) => {
      if (small) void savePhoto(ref, "model", small.blob, small.width, small.height);
    });
  }, []);

  return taking ? <ModelThumbnail onPicture={onPicture} /> : null;
}
