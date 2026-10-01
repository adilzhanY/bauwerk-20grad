/**
 * Client for lod2-vision, the optional local SAM 3 service.
 *
 * Both calls upload an image and get JSON back, parsed through the lod2-core schemas like
 * every other response. The service may simply not be running; `visionAvailable` is how
 * the UI decides whether to offer the button at all.
 */
import { authHeaders } from "@/auth/api";
import {
  VisionCornersSchema,
  VisionOpeningsSchema,
  type VisionCorners,
  type VisionOpening,
} from "lod2-core/api";
import { UserError } from "./errors.ts";
import { postInLine } from "./queue.ts";

const BASE = "/vision";

async function postForm(
  path: string,
  form: FormData,
  signal?: AbortSignal,
  onAhead?: (ahead: number) => void,
): Promise<unknown> {
  const res = await postInLine(BASE, path, form, signal, onAhead);
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw describeFailure(res.status, text);
  }
  return res.json();
}

/** An error the user can act on, rather than a status code. */
function describeFailure(status: number, text: string): Error {
  // The Vite proxy answers 502 or 504 when nothing listens on the service's port.
  if (status === 502 || status === 504) return new UserError("photo.error.visionDown");
  // The service's own explanation is in English and passed on as it is.
  const detail = readDetail(text);
  return detail ? new Error(detail) : new UserError("photo.error.visionFailed", { status });
}

/** The service's own explanation, when it sent one as a plain string. */
function readDetail(text: string): string | null {
  try {
    const detail = (JSON.parse(text) as { detail?: unknown }).detail;
    return typeof detail === "string" && detail ? detail : null;
  } catch {
    return null;
  }
}

/** True when the service answers its health route. Cheap, and safe to call on every open. */
export async function visionAvailable(signal?: AbortSignal): Promise<boolean> {
  try {
    const res = await fetch(`${BASE}/health`, { signal, headers: await authHeaders() });
    return res.ok;
  } catch {
    return false;
  }
}

/** Where the wall is in the photo, with occluders painted out. */
export async function findWallCorners(
  photo: File,
  wallWidthM: number,
  wallHeightM: number,
  signal?: AbortSignal,
  onAhead?: (ahead: number) => void,
): Promise<VisionCorners> {
  const form = new FormData();
  form.append("photo", photo);
  form.append("wallWidth", String(wallWidthM));
  form.append("wallHeight", String(wallHeightM));
  return VisionCornersSchema.parse(await postForm("/corners", form, signal, onAhead));
}

/** Windows and doors on a rectified wall image, in wall metres. */
export async function findOpenings(
  rectified: Blob,
  pixelsPerMetre: number,
  signal?: AbortSignal,
  onAhead?: (ahead: number) => void,
): Promise<VisionOpening[]> {
  const form = new FormData();
  form.append("image", rectified, "wall.png");
  form.append("pixelsPerMetre", String(pixelsPerMetre));
  return VisionOpeningsSchema.parse(await postForm("/openings", form, signal, onAhead)).openings;
}
