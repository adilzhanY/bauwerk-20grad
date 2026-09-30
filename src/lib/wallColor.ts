/**
 * The colour of a facade from its straightened photo: the median of every pixel that is not
 * an opening, per channel. The median, not the mean, so a drain pipe, a shadow line or a sign
 * does not tint the result; the windows are left out because glass and frames are not the
 * wall. Cars and trees are already painted over in the wall's own colour by the detection.
 */
import type { Opening } from "lod2-core/openings";

/** A rectangle of pixels to leave out, half-open: x0 <= x < x1. */
export interface PixelRect {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

/** "#rrggbb" of the median pixel outside `skip`, or null when nothing is left. */
export function medianColour(
  data: Uint8ClampedArray,
  width: number,
  height: number,
  skip: readonly PixelRect[] = [],
): string | null {
  const bins = [new Uint32Array(256), new Uint32Array(256), new Uint32Array(256)] as const;
  let count = 0;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (skip.some((r) => x >= r.x0 && x < r.x1 && y >= r.y0 && y < r.y1)) continue;
      const i = (y * width + x) * 4;
      // Transparent pixels lie outside the straightened wall.
      if ((data[i + 3] ?? 0) < 128) continue;
      for (let c = 0; c < 3; c++) {
        const bin = bins[c as 0 | 1 | 2];
        const value = data[i + c] ?? 0;
        bin[value] = (bin[value] ?? 0) + 1;
      }
      count++;
    }
  }
  if (count === 0) return null;
  const median = (bin: Uint32Array) => {
    let seen = 0;
    for (let v = 0; v < 256; v++) {
      seen += bin[v] ?? 0;
      if (seen * 2 >= count) return v;
    }
    return 255;
  };
  return `#${bins.map((b) => median(b).toString(16).padStart(2, "0")).join("")}`;
}

/** The openings, in wall metres from the bottom left, as pixel rectangles of the image. */
export function openingRects(
  openings: readonly Opening[],
  imageHeight: number,
  pixelsPerMetre: number,
): PixelRect[] {
  return openings.map((o) => ({
    x0: Math.floor(o.x * pixelsPerMetre),
    x1: Math.ceil((o.x + o.width) * pixelsPerMetre),
    y0: Math.floor(imageHeight - (o.y + o.height) * pixelsPerMetre),
    y1: Math.ceil(imageHeight - o.y * pixelsPerMetre),
  }));
}

/** Longest side the photo is shrunk to before counting: plenty for a median, and quick. */
const SAMPLE_SIDE = 240;

/** The facade colour of a straightened wall photo, in the browser. Null when it cannot be read. */
export async function facadeColourOf(
  image: { blob: Blob; width: number; height: number },
  openings: readonly Opening[],
  pixelsPerMetre: number,
): Promise<string | null> {
  if (typeof createImageBitmap === "undefined") return null;
  const bitmap = await createImageBitmap(image.blob);
  const scale = Math.min(1, SAMPLE_SIDE / Math.max(image.width, image.height));
  const width = Math.max(1, Math.round(image.width * scale));
  const height = Math.max(1, Math.round(image.height * scale));
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  if (!context) return null;
  context.drawImage(bitmap, 0, 0, width, height);
  bitmap.close();
  const { data } = context.getImageData(0, 0, width, height);
  return medianColour(data, width, height, openingRects(openings, height, pixelsPerMetre * scale));
}
