import type { MessageKey } from "@/i18n";

/** How long the card stays on "done", so the total time can be read before it goes. */
export const DETECTION_DONE_MS = 4000;
/** Length of the card's fade and collapse when it leaves. Matches .detect-presence in lod2.css. */
export const DETECTION_LEAVE_MS = 320;

/** Above this hidden fraction the bottom dots came from perspective and deserve a look. */
export const BASE_HIDDEN_WARN = 0.8;

const CORNER_LABELS: readonly MessageKey[] = [
  "photo.corner.topLeft",
  "photo.corner.topRight",
  "photo.corner.bottomRight",
  "photo.corner.bottomLeft",
];

/** The name of a dot, in the order the corners are stored: top left, then clockwise. */
export function cornerLabel(index: number): MessageKey {
  return CORNER_LABELS[index] ?? "photo.corner";
}

/** Magnifier shown while dragging a dot. */
export const LOUPE_SIZE_PX = 220;

/** Loupe magnification: the default, and the range the slider and the mouse wheel allow. */
export const LOUPE_ZOOM_DEFAULT = 1.5;

export const LOUPE_ZOOM_MIN = 1;

export const LOUPE_ZOOM_MAX = 6;

export const LOUPE_ZOOM_STEP = 0.25;

/** Gap between the cursor and the loupe, so the hand does not cover it. */
export const LOUPE_GAP_PX = 24;

/** Box the rectified preview has to fit in, in screen pixels. */
export const PREVIEW_MAX_PX = 400;

/** New dots start this fraction of the photo inside each corner, so they are visible and easy to grab. */
export const CORNER_INSET_FRACTION = 0.08;

/** Free screen pixels around the photo, so a dot on the photo's edge is not cut off. */
export const STAGE_MARGIN_PX = 24;

/**
 * Longest side of the working copy of the photo. A 24 megapixel phone photo is ~100 MB of
 * raw bytes, three times over, which is enough to kill the tab; the preview and the loupe
 * never need more than this.
 */
export const WORKING_MAX_PX = 1600;

/**
 * Resolution of the rectified wall: 100 px per metre is 1 pixel per centimetre. It is also
 * the contract with lod2-vision, which converts its boxes back to metres with it.
 */
export const WALL_PX_PER_METRE = 100;

/** Largest wall image Apply will build, so a very long wall cannot freeze the tab. */
export const WALL_MAX_MEGAPIXELS = 25;

/** Drags shorter than this on both sides are clicks, not openings. */
export const MIN_OPENING_M = 0.05;

/** Space left between an opening and its duplicate. */
export const DUPLICATE_GAP_M = 0.2;

/** Beyond this, the camera's compass and the wall's facing disagree enough to warn. */
export const COMPASS_WARN_DEG = 30;

/**
 * Upper bound of the opening edit fields. Deliberately loose: the fields accept any size and
 * the editor clamps the opening to the wall, exactly as it did with plain number inputs.
 */
export const OPENING_FIELD_MAX_M = 1000;

/** Undo steps kept for the openings of one wall. */
export const OPENINGS_HISTORY_LIMIT = 200;

/** Length of the editor's close animation. Matches .photo-editor-overlay in lod2.css. */
export const PHOTO_EDITOR_LEAVE_MS = 180;
