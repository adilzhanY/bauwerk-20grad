import { useEffect, useState } from "react";
import { SRGBColorSpace, TextureLoader } from "three";
import type { Texture } from "three";
import { useEditorStore } from "@/store/building";
import type { Underlay as UnderlayData } from "@/store/building";

/** The floor plan image on the ground, under everything else. Not raycast, so tools work through it. */
export function Underlay() {
  const underlay = useEditorStore((s) => s.underlay);
  if (!underlay) return null;
  return <UnderlayPlane key={underlay.url} underlay={underlay} />;
}

function UnderlayPlane({ underlay }: { underlay: UnderlayData }) {
  const [texture, setTexture] = useState<Texture | null>(null);
  // Loaded by hand and disposed on unmount: useLoader would cache every picture for good.
  useEffect(() => {
    let live = true;
    let loaded: Texture | null = null;
    new TextureLoader().load(underlay.url, (t) => {
      t.colorSpace = SRGBColorSpace;
      loaded = t;
      if (live) setTexture(t);
      else t.dispose();
    });
    return () => {
      live = false;
      loaded?.dispose();
    };
  }, [underlay.url]);
  if (!texture) return null;
  const w = underlay.widthMetres;
  const h = w * underlay.aspect;
  return (
    <mesh
      position={[underlay.x, 0.004, underlay.y]}
      rotation={[-Math.PI / 2, 0, 0]}
      raycast={() => null}
    >
      <planeGeometry args={[w, h]} />
      <meshBasicMaterial
        map={texture}
        transparent
        opacity={underlay.opacity}
        depthWrite={false}
        toneMapped={false}
      />
    </mesh>
  );
}
