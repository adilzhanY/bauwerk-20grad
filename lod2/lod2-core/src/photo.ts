/**
 * Maths for placing a photograph inside a screen box and mapping points between the two.
 *
 * Everything the editor remembers about a photo is in *photo pixels*: the coordinate a point
 * has in the original image, independent of how large it is drawn on screen. Screen pixels
 * are derived from that through a `Fit` and never stored.
 */

/** A 2D point. In photo pixels or screen pixels depending on the function. */
export interface Point2 {
  x: number
  y: number
}

/** How an image is drawn inside a box: uniform scale plus the offset of its top-left corner. */
export interface Fit {
  scale: number
  offsetX: number
  offsetY: number
  /** Drawn size on screen. */
  width: number
  height: number
}

/** Scale an image down (or up) to fit a box, keeping its aspect ratio, and centre it. */
export function fitImage(
  imageWidth: number,
  imageHeight: number,
  boxWidth: number,
  boxHeight: number,
): Fit {
  if (imageWidth <= 0 || imageHeight <= 0 || boxWidth <= 0 || boxHeight <= 0) {
    return { scale: 0, offsetX: 0, offsetY: 0, width: 0, height: 0 }
  }
  const scale = Math.min(boxWidth / imageWidth, boxHeight / imageHeight)
  const width = imageWidth * scale
  const height = imageHeight * scale
  const offsetX = (boxWidth - width) / 2
  const offsetY = (boxHeight - height) / 2
  return { scale, offsetX, offsetY, width, height }
}

export function photoToScreen(point: Point2, fit: Fit): Point2 {
  return {
    x: fit.offsetX + point.x * fit.scale,
    y: fit.offsetY + point.y * fit.scale,
  }
}

export function screenToPhoto(point: Point2, fit: Fit): Point2 {
  if (fit.scale <= 0) return { x: 0, y: 0 }
  return {
    x: (point.x - fit.offsetX) / fit.scale,
    y: (point.y - fit.offsetY) / fit.scale,
  }
}

/** Keep a point inside the image, edges included. */
export function clampToImage(point: Point2, imageWidth: number, imageHeight: number): Point2 {
  const clamp = (v: number, max: number) => Math.min(Math.max(v, 0), max)
  return { x: clamp(point.x, imageWidth), y: clamp(point.y, imageHeight) }
}

/** Four corners of an image: top-left, top-right, bottom-right, bottom-left. */
export type Quad = [Point2, Point2, Point2, Point2]

export function initialCorners(imageWidth: number, imageHeight: number): Quad {
  return [
    { x: 0, y: 0 },
    { x: imageWidth, y: 0 },
    { x: imageWidth, y: imageHeight },
    { x: 0, y: imageHeight },
  ]
}

/** What a magnifier window needs in order to show the photo around one point. */
export interface Loupe {
  /** Size of the zoomed photo, in screen pixels. */
  backgroundWidth: number
  backgroundHeight: number
  /** Where the zoomed photo's top-left corner sits relative to the window's top-left. */
  backgroundX: number
  backgroundY: number
}

/**
 * Place a zoomed copy of the photo so that `point` (in photo pixels) lands in the centre
 * of a square window of side `windowSize`.
 */
export function loupeBackground(
  point: Point2,
  imageWidth: number,
  imageHeight: number,
  zoom: number,
  windowSize: number,
): Loupe {
  const half = windowSize / 2
  return {
    backgroundWidth: imageWidth * zoom,
    backgroundHeight: imageHeight * zoom,
    backgroundX: half - point.x * zoom,
    backgroundY: half - point.y * zoom,
  }
}

/**
 * The four corners moved inwards by `fraction` of the width and height, in the same order as
 * `initialCorners`. Dots placed here start fully visible and easy to grab.
 */
export function insetCorners(imageWidth: number, imageHeight: number, fraction: number): Quad {
  const dx = imageWidth * fraction
  const dy = imageHeight * fraction
  return [
    { x: dx, y: dy },
    { x: imageWidth - dx, y: dy },
    { x: imageWidth - dx, y: imageHeight - dy },
    { x: dx, y: imageHeight - dy },
  ]
}

/**
 * Like `fitImage`, but keeps `margin` screen pixels free on every side of the box, so
 * anything drawn on the image edge is not cut off by the box.
 */
export function fitImageWithMargin(
  imageWidth: number,
  imageHeight: number,
  boxWidth: number,
  boxHeight: number,
  margin: number,
): Fit {
  const inner = fitImage(imageWidth, imageHeight, boxWidth - 2 * margin, boxHeight - 2 * margin)
  if (inner.scale <= 0) return inner
  return { ...inner, offsetX: inner.offsetX + margin, offsetY: inner.offsetY + margin }
}
