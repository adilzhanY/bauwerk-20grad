import type { VisionOpening } from "lod2-core/api";
import type { Quad } from "lod2-core/photo";
import type { WallPlane } from "lod2-core/wall";
import { UserError } from "@/lod2/api/errors";
import { findOpenings, findWallCorners } from "@/lod2/api/vision";
import { WALL_PX_PER_METRE } from "@/components/photo-editor/constants";
import { buildWallImage } from "@/components/photo-editor/images";
import type { DetectionStage, WallImage } from "@/components/photo-editor/types";

/** How the workflow reports back to the editor while it runs. */
export interface DetectionHooks {
  signal: AbortSignal;
  /** Called when a new stage starts, with the hidden-base fraction once it is known. */
  onStage: (stage: Extract<DetectionStage, "rectify" | "openings">, baseHidden: number) => void;
  /** Show the painted photo with the proposed dots; resolves with the loaded image. */
  showPaintedPhoto: (url: string, corners: Quad) => Promise<HTMLImageElement>;
  /** Called with the rectified wall as soon as it exists, before the openings are read. */
  onWallImage: (image: WallImage) => void;
}

export interface DetectionResult {
  openings: VisionOpening[];
}

/**
 * The automatic workflow: corners from lod2-vision, the painted photo in place of the
 * original, the wall rectified in the browser with the same code the dots use, then the
 * openings from lod2-vision on that rectified wall.
 *
 * Returns null when aborted. Throws on failure, a UserError where the reason is known.
 */
export async function detectWall(
  file: File,
  wall: WallPlane,
  hooks: DetectionHooks,
): Promise<DetectionResult | null> {
  const { signal } = hooks;
  const clock = stageClock();
  const found = await findWallCorners(file, wall.width, wall.height, signal);
  if (isAborted(signal)) return null;
  clock.lap(`corners (service ${found.seconds.toFixed(1)} s)`);
  const corners = found.corners.map(([x, y]) => ({ x, y })) as Quad;
  hooks.onStage("rectify", found.baseHidden);

  const img = await hooks.showPaintedPhoto(found.paintedPhoto, corners);
  if (isAborted(signal)) return null;
  clock.lap("painted photo shown");
  const built = await buildWallImage(img, corners, wall);
  if (built instanceof UserError) throw built;
  if (isAborted(signal)) return null;
  hooks.onWallImage(built);
  clock.lap(`wall straightened (${built.width} x ${built.height} px)`);

  hooks.onStage("openings", found.baseHidden);
  const openings = await findOpenings(built.blob, WALL_PX_PER_METRE, signal);
  if (isAborted(signal)) return null;
  clock.lap(`openings (${openings.length})`);
  clock.total();
  return { openings };
}

/** Only the last stage: read the openings again on a rectified wall that already exists. */
export async function detectOpeningsOnly(
  image: WallImage,
  signal: AbortSignal,
): Promise<VisionOpening[] | null> {
  const openings = await findOpenings(image.blob, WALL_PX_PER_METRE, signal);
  return isAborted(signal) ? null : openings;
}

/**
 * Stage times in the browser console, so a slow run shows where its seconds went. The
 * corner line also gives the service's own time; the rest of that stage is the upload
 * and the painted photo coming back.
 */
function stageClock() {
  const start = performance.now();
  let last = start;
  const seconds = (ms: number) => `${(ms / 1000).toFixed(2)} s`;
  return {
    lap(label: string) {
      const now = performance.now();
      console.info(`[detect] ${label}: ${seconds(now - last)}`);
      last = now;
    },
    total() {
      console.info(`[detect] total: ${seconds(performance.now() - start)}`);
    },
  };
}

/**
 * Whether the job was cancelled. A function rather than `signal.aborted` inline, because
 * TypeScript keeps a property narrowed across an `await` and would call every check after
 * the first one dead, while the signal can abort at any await.
 */
function isAborted(signal: AbortSignal): boolean {
  return signal.aborted;
}
