/**
 * Resample a photograph onto a flat wall, so the result is metric: every output pixel is
 * a known number of metres of facade.
 *
 * Works on raw RGBA byte arrays and nothing else, so it runs the same in Node and in the
 * browser and can be tested without a canvas.
 */
import { applyHomography, homographyFromPairs, type Homography } from './homography.ts'
import type { Quad } from './photo.ts'

export interface RgbaImage {
  width: number
  height: number
  /** Row-major RGBA, 4 bytes per pixel. */
  data: Uint8ClampedArray
}

/** The four wall corners in metres, in the same order as the photo dots. */
export function wallCornersInMetres(width: number, height: number): Quad {
  return [
    { x: 0, y: height },
    { x: width, y: height },
    { x: width, y: 0 },
    { x: 0, y: 0 },
  ]
}

/**
 * The homography from rectified-image pixels to photo pixels.
 *
 * The rectified image has (0, 0) at its top-left like any image, so its y runs down while
 * wall metres run up. The corner lists are built so that flip is part of the mapping.
 */
export function rectifyHomography(
  photoCorners: Quad,
  outputWidth: number,
  outputHeight: number,
): Homography | null {
  const outputCorners: Quad = [
    { x: 0, y: 0 },
    { x: outputWidth, y: 0 },
    { x: outputWidth, y: outputHeight },
    { x: 0, y: outputHeight },
  ]
  return homographyFromPairs(outputCorners, photoCorners)
}

export type Sampling = 'nearest' | 'bilinear'

/**
 * Backward-map every output pixel to the photo and read the photo there.
 * Pixels that fall outside the photo are left transparent black.
 *
 * `nearest` copies one photo pixel and is right for quick previews. `bilinear` blends the
 * four photo pixels around the sample point, which matters when the output is finer than
 * the photo, as a 1 cm per pixel wall image is.
 */
export function rectifyImage(
  photo: RgbaImage,
  photoCorners: Quad,
  outputWidth: number,
  outputHeight: number,
  sampling: Sampling = 'nearest',
): RgbaImage | null {
  if (!isPositiveInteger(outputWidth) || !isPositiveInteger(outputHeight)) return null
  const H = rectifyHomography(photoCorners, outputWidth, outputHeight)
  if (!H) return null

  const out = new Uint8ClampedArray(outputWidth * outputHeight * 4)
  for (let oy = 0; oy < outputHeight; oy++) {
    for (let ox = 0; ox < outputWidth; ox++) {
      // Sample at the pixel centre so a 1:1 mapping copies pixels exactly.
      const source = applyHomography(H, { x: ox + 0.5, y: oy + 0.5 })
      const to = (oy * outputWidth + ox) * 4
      if (sampling === 'bilinear') sampleBilinear(photo, source.x, source.y, out, to)
      else sampleNearest(photo, source.x, source.y, out, to)
    }
  }
  return { width: outputWidth, height: outputHeight, data: out }
}

function sampleNearest(photo: RgbaImage, x: number, y: number, out: Uint8ClampedArray, to: number): void {
  const sx = Math.floor(x)
  const sy = Math.floor(y)
  if (sx < 0 || sy < 0 || sx >= photo.width || sy >= photo.height) return
  const from = (sy * photo.width + sx) * 4
  out[to] = photo.data[from]!
  out[to + 1] = photo.data[from + 1]!
  out[to + 2] = photo.data[from + 2]!
  out[to + 3] = photo.data[from + 3]!
}

/**
 * Blend the four pixels around (x, y). Pixel centres sit at half-integers, so the sample
 * point is shifted by half a pixel before finding its neighbours.
 */
function sampleBilinear(photo: RgbaImage, x: number, y: number, out: Uint8ClampedArray, to: number): void {
  const fx = x - 0.5
  const fy = y - 0.5
  const x0 = Math.floor(fx)
  const y0 = Math.floor(fy)
  const tx = fx - x0
  const ty = fy - y0
  const x1 = x0 + 1
  const y1 = y0 + 1
  if (x0 < 0 || y0 < 0 || x1 >= photo.width || y1 >= photo.height) {
    sampleNearest(photo, x, y, out, to)
    return
  }
  const w00 = (1 - tx) * (1 - ty)
  const w10 = tx * (1 - ty)
  const w01 = (1 - tx) * ty
  const w11 = tx * ty
  const i00 = (y0 * photo.width + x0) * 4
  const i10 = (y0 * photo.width + x1) * 4
  const i01 = (y1 * photo.width + x0) * 4
  const i11 = (y1 * photo.width + x1) * 4
  for (let c = 0; c < 4; c++) {
    out[to + c] =
      photo.data[i00 + c]! * w00 +
      photo.data[i10 + c]! * w10 +
      photo.data[i01 + c]! * w01 +
      photo.data[i11 + c]! * w11
  }
}

function isPositiveInteger(value: number): boolean {
  return Number.isInteger(value) && value > 0
}

/** Output size for a wall at a fixed number of pixels per metre, for example 100 for 1 cm. */
export function metricSize(
  wallWidth: number,
  wallHeight: number,
  pixelsPerMetre: number,
): { width: number; height: number } {
  return {
    width: Math.max(1, Math.round(wallWidth * pixelsPerMetre)),
    height: Math.max(1, Math.round(wallHeight * pixelsPerMetre)),
  }
}

/** Preview size in pixels for a wall of the given metric size, fitting a box. */
export function previewSize(
  wallWidth: number,
  wallHeight: number,
  maxWidth: number,
  maxHeight: number,
): { width: number; height: number } {
  if (wallWidth <= 0 || wallHeight <= 0) return { width: 0, height: 0 }
  const scale = Math.min(maxWidth / wallWidth, maxHeight / wallHeight)
  return {
    width: Math.max(1, Math.round(wallWidth * scale)),
    height: Math.max(1, Math.round(wallHeight * scale)),
  }
}
