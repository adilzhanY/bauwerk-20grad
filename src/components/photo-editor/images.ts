import type { Quad } from "lod2-core/photo";
import { metricSize, rectifyImage } from "lod2-core/rectify";
import type { WallPlane } from "lod2-core/wall";
import { UserError } from "@/lod2/api/errors";
import {
  WALL_MAX_MEGAPIXELS,
  WALL_PX_PER_METRE,
  WORKING_MAX_PX,
} from "@/components/photo-editor/constants";
import type { WallImage, WorkingPhoto } from "@/components/photo-editor/types";

/**
 * Resample the full photo onto the wall at 1 cm per pixel. The full photo is decoded into
 * bytes only for the duration of this call. Returns an error instead of an image when the
 * wall is too large or the dots do not define a mapping.
 */
export async function buildWallImage(
  img: HTMLImageElement,
  corners: Quad,
  wall: WallPlane,
): Promise<WallImage | UserError> {
  const size = metricSize(wall.width, wall.height, WALL_PX_PER_METRE);
  const megapixels = (size.width * size.height) / 1e6;
  if (megapixels > WALL_MAX_MEGAPIXELS) {
    return new UserError("photo.error.tooLarge", {
      megapixels: megapixels.toFixed(0),
      limit: WALL_MAX_MEGAPIXELS,
    });
  }

  const source = document.createElement("canvas");
  source.width = img.naturalWidth;
  source.height = img.naturalHeight;
  const sourceCtx = source.getContext("2d");
  if (!sourceCtx) return new UserError("photo.error.readPhoto");
  sourceCtx.drawImage(img, 0, 0);
  const photo = sourceCtx.getImageData(0, 0, source.width, source.height);
  source.width = 0; // release the canvas backing store right away

  const rectified = rectifyImage(
    { width: photo.width, height: photo.height, data: photo.data },
    corners,
    size.width,
    size.height,
    "bilinear",
  );
  if (!rectified) return new UserError("photo.error.badShape");

  const target = document.createElement("canvas");
  target.width = rectified.width;
  target.height = rectified.height;
  const targetCtx = target.getContext("2d");
  if (!targetCtx) return new UserError("photo.error.createImage");
  const image = targetCtx.createImageData(rectified.width, rectified.height);
  image.data.set(rectified.data);
  targetCtx.putImageData(image, 0, 0);
  const blob = await canvasToBlob(target);
  if (!blob) return new UserError("photo.error.encodeImage");
  return {
    url: URL.createObjectURL(blob),
    width: rectified.width,
    height: rectified.height,
    blob,
    corners,
  };
}

/** The canvas as a PNG blob, or null when the browser cannot encode it. */
function canvasToBlob(canvas: HTMLCanvasElement): Promise<Blob | null> {
  return new Promise((resolve) => {
    canvas.toBlob(resolve, "image/png");
  });
}

/** Corner positions in working-copy pixels instead of full photo pixels. */
export function scaleQuad(corners: Quad, scale: number): Quad {
  return corners.map((c) => ({ x: c.x * scale, y: c.y * scale })) as Quad;
}

/** Draw the loaded photo into a canvas no larger than WORKING_MAX_PX and read it back. */
export function makeWorkingPhoto(img: HTMLImageElement): WorkingPhoto | null {
  const longest = Math.max(img.naturalWidth, img.naturalHeight);
  const scale = Math.min(1, WORKING_MAX_PX / longest);
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(img.naturalWidth * scale));
  canvas.height = Math.max(1, Math.round(img.naturalHeight * scale));
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
  const data = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const working = {
    scale: canvas.width / img.naturalWidth,
    url: canvas.toDataURL("image/jpeg", 0.85),
  } as WorkingPhoto;
  // Non-enumerable on purpose. React's dev build logs every changed prop with for...in, and
  // would list all 7.7 million bytes of the pixels, twice, freezing the page for about 20 s
  // per detection. for...in skips non-enumerable properties; reading `working.pixels` does not.
  Object.defineProperty(working, "pixels", {
    value: { width: data.width, height: data.height, data: data.data },
    enumerable: false,
  });
  return working;
}

/**
 * The same four corners, to a tenth of a pixel. A wall picture straightened from other
 * corners is a different picture: openings found on the old one no longer sit on it.
 */
export function sameCorners(a: Quad, b: Quad): boolean {
  return a.every((p, i) => {
    const q = b[i];
    return q !== undefined && Math.abs(p.x - q.x) < 0.1 && Math.abs(p.y - q.y) < 0.1;
  });
}
