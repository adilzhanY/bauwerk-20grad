import { useEffect, useState } from "react";
import * as THREE from "three";

/**
 * Load an orthophoto as a texture, or null if it is unavailable.
 *
 * Deliberately not `useLoader`/`useTexture`: those suspend and throw on failure, which
 * would blank the whole 3D scene when a WMS hiccups. Imagery is a nicety here (the
 * building must still render without it), so failures resolve to null and the caller
 * falls back to a flat colour.
 *
 * `loading` is reported because decoding and uploading a crop is not free: it happens on
 * the main thread, and the scene has to be able to say so rather than appear to hang.
 */
export interface OrthoTexture {
  texture: THREE.Texture | null;
  loading: boolean;
}

export function useOrthoTexture(url: string | null | undefined): OrthoTexture {
  // The outcome for one url: a texture, or null when it failed. Loading is simply "no
  // outcome for the current url yet", so nothing has to be reset when the url changes.
  const [result, setResult] = useState<{ url: string; texture: THREE.Texture | null } | null>(null);

  useEffect(() => {
    if (!url) return;
    let cancelled = false;
    let loaded: THREE.Texture | null = null;

    new THREE.TextureLoader().load(
      url,
      (t) => {
        if (cancelled) {
          t.dispose();
          return;
        }
        // Aerial imagery is sRGB-encoded; without this it renders dark and muddy.
        t.colorSpace = THREE.SRGBColorSpace;
        // flipY stays at its default true, which is what makes the mapping come out right:
        // a WMS image has row 0 at maxY (north) while orthoUv puts v=0 at minY (south),
        // and the flip cancels that. Verified top-down against the raw crop: the model's
        // roof continues the surrounding imagery seamlessly, with no north-south mirror.
        // UVs are clamped to the bbox, so repeating would only ever mirror edge artefacts.
        t.wrapS = THREE.ClampToEdgeWrapping;
        t.wrapT = THREE.ClampToEdgeWrapping;
        t.anisotropy = 8;
        loaded = t;
        setResult({ url, texture: t });
      },
      undefined,
      () => {
        if (cancelled) return;
        setResult({ url, texture: null });
      },
    );

    return () => {
      cancelled = true;
      loaded?.dispose();
      setResult(null);
    };
  }, [url]);

  if (!url) return { texture: null, loading: false };
  const done = result?.url === url;
  return { texture: done ? result.texture : null, loading: !done };
}
