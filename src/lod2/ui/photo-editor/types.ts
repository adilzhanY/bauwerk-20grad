import type { RgbaImage } from "lod2-core/rectify";

/** A width and a height in pixels. */
export interface Size {
  width: number;
  height: number;
}

/** Natural size of the loaded photo, in photo pixels. */
export type PhotoSize = Size;

/** A downscaled copy of the photo: raw bytes for rectifying, a data URL for the loupe. */
export interface WorkingPhoto {
  pixels: RgbaImage;
  /** Working pixels per full photo pixel, at most 1. */
  scale: number;
  url: string;
}

/** The full-resolution rectified wall, as a blob URL plus its size. Browser memory only. */
export interface WallImage {
  url: string;
  width: number;
  height: number;
  /** The PNG behind `url`, kept so it can be sent to lod2-vision without re-encoding. */
  blob: Blob;
}

/** What the main area shows: the photo with corner dots, or the rectified wall to draw on. */
export type EditorMode = "photo" | "wall";

/** How the wall is drawn while its openings are edited. */
export interface WallView {
  /** 0 shows the photo fully, 100 hides it and leaves only the openings. In percent. */
  transparency: number;
  showSizes: boolean;
}

/** The three things the detection does, in order, plus how it ended. */
export type DetectionStage = "corners" | "rectify" | "openings" | "done" | "failed";

export interface DetectionState {
  stage: DetectionStage;
  /** When the job started, from performance.now(), for the running clock. */
  startedAt: number;
  /** When it ended, done or failed. The clock stops on this exact time. */
  endedAt?: number;
  /** Set when the stage is `failed`. */
  message?: string;
  /** The stage that was running when it failed, so the card can mark that step. */
  failedAt?: DetectionStage;
  /** Fraction of the wall's base hidden by parked things, once the corners are known. */
  baseHidden?: number;
}
