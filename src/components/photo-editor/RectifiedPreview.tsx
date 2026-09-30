import { useFormat } from "@/lod2/format";
import type { Quad } from "lod2-core/photo";
import { previewSize, rectifyImage } from "lod2-core/rectify";
import type { WallPlane } from "lod2-core/wall";
import { useEffect, useMemo, useRef } from "react";
import { useT } from "@/i18n/useT";
import { Hint } from "@/components/shared/Hint";
import { PREVIEW_MAX_PX } from "@/components/photo-editor/constants";
import { scaleQuad } from "@/components/photo-editor/images";
import type { WorkingPhoto } from "@/components/photo-editor/types";

/**
 * The photo resampled onto the wall plane, at the wall's true proportions. Redrawn on
 * every corner change, which is cheap at preview size.
 */
export function RectifiedPreview({
  working,
  corners,
  wall,
}: {
  working: WorkingPhoto | null;
  corners: Quad | null;
  wall: WallPlane | null;
}) {
  const format = useFormat();
  const t = useT();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const size = useMemo(
    () => (wall ? previewSize(wall.width, wall.height, PREVIEW_MAX_PX, PREVIEW_MAX_PX) : null),
    [wall],
  );
  const ready = Boolean(working && corners && size && size.width > 0);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !working || !corners || !size || size.width === 0) return;
    const scaledCorners = scaleQuad(corners, working.scale);
    // Preview: the smaller working copy and nearest sampling, so it can be redrawn on every
    // mouse move. Apply uses the full photo and bilinear instead.
    const rectified = rectifyImage(working.pixels, scaledCorners, size.width, size.height);
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    if (!rectified) {
      ctx.clearRect(0, 0, size.width, size.height);
      return;
    }
    const image = ctx.createImageData(rectified.width, rectified.height);
    image.data.set(rectified.data);
    ctx.putImageData(image, 0, 0);
  }, [working, corners, size]);

  if (!wall) return <Hint>{t("photo.previewNoWall")}</Hint>;
  if (!ready || !size) return <Hint>{t("photo.previewNoPhoto")}</Hint>;

  return (
    <>
      <canvas
        ref={canvasRef}
        className="block max-w-full rounded-soft border border-line bg-ink"
        width={size.width}
        height={size.height}
      />
      <Hint>
        {format.size(wall.width, wall.height)}, {size.width} x {size.height} px
      </Hint>
    </>
  );
}
