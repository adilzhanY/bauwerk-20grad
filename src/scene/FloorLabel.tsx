import { useEffect, useMemo, useRef, useState } from "react";
import { useFrame } from "@react-three/fiber";
import { CanvasTexture, SRGBColorSpace } from "three";
import type { Group } from "three";
import type { Vec2 } from "@/geometry/types";
import { noRaycast } from "./three";
import { useSceneColors } from "./useSceneColors";

/** Pixels per metre of the label's texture: sharp from the usual distance, small to upload. */
const PX_PER_M = 256;
/** Height of the name in metres, the area below it is a little smaller. */
const NAME_M = 0.32;
const AREA_M = 0.26;
/** Never wider than this share of the room, so the print stays inside its walls. */
const ROOM_SHARE = 0.8;

/** Resolves when the page fonts are in, so the canvas draws in IBM Plex and Geist, not a fallback. */
const fontsReady: Promise<unknown> =
  typeof document !== "undefined" && "fonts" in document ? document.fonts.ready : Promise.resolve();

function cssFont(token: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(token).trim() || "sans-serif";
}

/**
 * The room's name and area printed on its floor: walls in front hide it and from a low angle
 * it lies flat, so it never covers the facade. It turns in quarter steps to read upright
 * from wherever the camera stands.
 */
export function FloorLabel({
  name,
  area,
  centre,
  polygon,
  elevation,
}: {
  name: string;
  area: string;
  centre: Vec2;
  polygon: readonly Vec2[];
  elevation: number;
}) {
  const { ink, muted } = useSceneColors();
  const [fontsIn, setFontsIn] = useState(false);
  useEffect(() => {
    let live = true;
    void fontsReady.then(() => {
      if (live) setFontsIn(true);
    });
    return () => {
      live = false;
    };
  }, []);

  const label = useMemo(() => {
    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    const nameFont = `500 ${String(NAME_M * PX_PER_M)}px ${cssFont("--font-sans")}`;
    const areaFont = `${String(AREA_M * PX_PER_M)}px ${cssFont("--font-num")}`;
    ctx.font = nameFont;
    const nameWidth = ctx.measureText(name).width;
    ctx.font = areaFont;
    const areaWidth = ctx.measureText(area).width;
    const pad = 0.06 * PX_PER_M;
    canvas.width = Math.ceil(Math.max(nameWidth, areaWidth) + 2 * pad);
    canvas.height = Math.ceil((NAME_M + AREA_M + 0.1) * PX_PER_M + 2 * pad);
    // Resizing the canvas resets its state, so the fonts are set again for drawing.
    ctx.textAlign = "center";
    ctx.textBaseline = "alphabetic";
    ctx.font = nameFont;
    ctx.fillStyle = ink;
    ctx.fillText(name, canvas.width / 2, pad + NAME_M * PX_PER_M * 0.85);
    ctx.font = areaFont;
    ctx.fillStyle = muted;
    ctx.fillText(area, canvas.width / 2, canvas.height - pad - AREA_M * PX_PER_M * 0.2);
    const texture = new CanvasTexture(canvas);
    texture.colorSpace = SRGBColorSpace;
    texture.anisotropy = 8;
    return { texture, width: canvas.width / PX_PER_M, height: canvas.height / PX_PER_M };
    // fontsIn redraws the label once the page fonts have loaded.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [name, area, ink, muted, fontsIn]);
  useEffect(
    () => () => {
      label?.texture.dispose();
    },
    [label],
  );

  // A label wider or deeper than the room shrinks to fit; it never grows past its print size.
  const scale = useMemo(() => {
    if (!label) return 1;
    const xs = polygon.map((p) => p.x);
    const ys = polygon.map((p) => p.y);
    const span = Math.min(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys));
    return Math.min(1, (ROOM_SHARE * span) / Math.max(label.width, label.height));
  }, [label, polygon]);

  const turn = useRef<Group>(null);
  useFrame(({ camera }) => {
    const group = turn.current;
    if (!group) return;
    // The text's foot faces the camera, snapped to a quarter turn so it does not spin.
    const angle = Math.atan2(camera.position.x - centre.x, camera.position.z - centre.y);
    const snapped = Math.round(angle / (Math.PI / 2)) * (Math.PI / 2);
    if (group.rotation.y !== snapped) group.rotation.y = snapped;
  });

  if (!label) return null;
  return (
    <group ref={turn} position={[centre.x, elevation + 0.02, centre.y]}>
      <mesh rotation={[-Math.PI / 2, 0, 0]} scale={scale} raycast={noRaycast}>
        <planeGeometry args={[label.width, label.height]} />
        <meshBasicMaterial
          map={label.texture}
          transparent
          depthWrite={false}
          toneMapped={false}
          polygonOffset
          polygonOffsetFactor={-2}
        />
      </mesh>
    </group>
  );
}
