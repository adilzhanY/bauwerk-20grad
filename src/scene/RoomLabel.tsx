import { useEffect, useMemo, useState } from "react";
import { CanvasTexture, SRGBColorSpace } from "three";
import type { Vec2 } from "@/geometry/types";
import { noRaycast } from "./three";
import { useSceneColors } from "./useSceneColors";

/** Pixels per metre of the label's texture: sharp from the usual distance, small to upload. */
const PX_PER_M = 256;
/** Height of the name in metres, the area below it is a little smaller. */
const NAME_M = 0.32;
const AREA_M = 0.26;
/** Never wider than this share of the room, so the card stays inside its walls. */
const ROOM_SHARE = 0.8;

/** Resolves when the page fonts are in, so the canvas draws in IBM Plex and Geist, not a fallback. */
const fontsReady: Promise<unknown> =
  typeof document !== "undefined" && "fonts" in document ? document.fonts.ready : Promise.resolve();

function cssFont(token: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(token).trim() || "sans-serif";
}

/**
 * The room's name and area on a small card standing on its floor. It always faces the camera,
 * so it reads upright from every side, and it is part of the 3D scene: walls in front hide it
 * and it never draws over the facade.
 */
export function RoomLabel({
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
  const { ink, muted, paper } = useSceneColors();
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
    ctx.globalAlpha = 0.9;
    ctx.fillStyle = paper;
    ctx.beginPath();
    ctx.roundRect(0, 0, canvas.width, canvas.height, pad);
    ctx.fill();
    ctx.globalAlpha = 1;
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
  }, [name, area, ink, muted, paper, fontsIn]);
  useEffect(
    () => () => {
      label?.texture.dispose();
    },
    [label],
  );

  // A card wider or deeper than the room shrinks to fit; it never grows past its own size.
  const scale = useMemo(() => {
    if (!label) return 1;
    const xs = polygon.map((p) => p.x);
    const ys = polygon.map((p) => p.y);
    const span = Math.min(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys));
    return Math.min(1, (ROOM_SHARE * span) / Math.max(label.width, label.height));
  }, [label, polygon]);

  if (!label) return null;
  const width = label.width * scale;
  const height = label.height * scale;
  // Its foot just above the floor: walls in front hide it, as they hide the floor.
  return (
    <sprite
      position={[centre.x, elevation + 0.02 + height / 2, centre.y]}
      scale={[width, height, 1]}
      raycast={noRaycast}
    >
      <spriteMaterial map={label.texture} transparent depthWrite={false} toneMapped={false} />
    </sprite>
  );
}
