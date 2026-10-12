/**
 * Projects for the Projects page: listing them, opening one, and keeping their pictures.
 *
 * With a server (VITE_API_URL) a project is a row on the server, its pictures too. Without
 * one, a project is a building kept in this browser under its own id (lib/storage.ts,
 * `project.localId`), and its pictures sit in IndexedDB under that id. Either way a project
 * exists only once it was saved (projects/session.ts), and two projects of the same house
 * share nothing. Both look the same
 * to the page: a card with a summary, a time and a way to open it.
 */
import { apiBase, authHeaders } from "@/auth/api";
import { projectSummary } from "@/geometry/project";
import type { ProjectSummary as CardSummary } from "@/geometry/project";
import type { Building, ProjectInfo } from "@/geometry/types";
import { listProjectCopies, removeProjectCopy } from "@/lib/storage";
import { useEditorStore } from "@/store/building";
import { listProjects, syncEnabled } from "@/sync/useSync";
import type { HereNow } from "@/sync/useSync";
import { localPhotos } from "./localPhotos";

export type ProjectRef = { kind: "server"; id: string } | { kind: "local"; id: string };

export interface ProjectCard {
  ref: ProjectRef;
  buildingId: string;
  summary: CardSummary;
  updatedAt: string;
  /** Its owner, when accounts are on. */
  owner: { id: string; firstName: string; lastName: string } | null;
  /** Who has it open right now, and when the viewer last had it open (server projects). */
  here: HereNow[];
  lastSeenAt: string | null;
}

const refKey = (ref: ProjectRef) => `${ref.kind}:${ref.id}`;
export const sameRef = (a: ProjectRef | null, b: ProjectRef | null) =>
  a !== null && b !== null && refKey(a) === refKey(b);

/** Every project, newest first. */
export async function listProjectCards(): Promise<ProjectCard[]> {
  if (syncEnabled) {
    const projects = await listProjects();
    return projects.flatMap((p) =>
      p.summary && p.buildingId
        ? [
            {
              ref: { kind: "server", id: p.id } as const,
              buildingId: p.buildingId,
              summary: p.summary,
              updatedAt: p.updatedAt,
              owner: p.owner ?? null,
              here: p.here ?? [],
              lastSeenAt: p.lastSeenAt ?? null,
            },
          ]
        : [],
    );
  }
  return listProjectCopies().map(({ building, savedAt }) => ({
    ref: { kind: "local", id: building.project?.localId ?? "" } as const,
    buildingId: building.id,
    summary: projectSummary(building),
    updatedAt: savedAt,
    owner: null,
    here: [],
    lastSeenAt: null,
  }));
}

/**
 * The saved project an editor state has open, or null while its work is not saved. With a
 * server a copy kept in this browser (from before there was one) is not saved: the Projects
 * page does not list it, so work in it would be lost without anyone being asked.
 */
export function projectRefOf(state: {
  projectId: string | null;
  building: Building;
}): ProjectRef | null {
  if (state.projectId) return { kind: "server", id: state.projectId };
  const localId = state.building.project?.localId;
  return localId && !syncEnabled ? { kind: "local", id: localId } : null;
}

/** The project open in the editor, or null when the editor holds a loose building. */
export function currentProjectRef(): ProjectRef | null {
  return projectRefOf(useEditorStore.getState());
}

/** Deletes a project with its pictures. */
export async function deleteProjectCard(card: ProjectCard): Promise<boolean> {
  if (card.ref.kind === "server") {
    const url = serverUrl(`/projects/${card.ref.id}`);
    if (!url) return false;
    const res = await fetch(url, { method: "DELETE", headers: await authHeaders() });
    return res.ok;
  }
  removeProjectCopy(card.ref.id);
  await localPhotos.removeAll(card.ref.id);
  return true;
}

/** The building with its project facts merged in; the same object when nothing changes. */
export function withProject(building: Building, info: ProjectInfo): Building {
  const current = building.project;
  const same =
    current !== undefined &&
    (Object.keys(info) as (keyof ProjectInfo)[]).every((k) => current[k] === info[k]);
  return same ? building : { ...building, project: { ...current, ...info } };
}

// Pictures ---------------------------------------------------------------------------------

export interface PhotoSlot {
  /** A footprint edge ("0", "1", ...), "thumbnail" (the card picture) or "model" (3D view). */
  slot: string;
  width: number;
  height: number;
  /** When the picture in this slot was put there; a new time means it was replaced. */
  updatedAt?: string;
}

function serverUrl(path: string): string | null {
  const base = apiBase();
  return base ? `${base}${path}` : null;
}

export async function savePhoto(
  ref: ProjectRef,
  slot: string,
  blob: Blob,
  width: number,
  height: number,
): Promise<void> {
  if (ref.kind === "local") {
    await localPhotos.put(ref.id, slot, { blob, width, height });
    return;
  }
  const url = serverUrl(`/projects/${ref.id}/photos/${slot}`);
  if (!url) return;
  const res = await fetch(url, {
    method: "PUT",
    headers: {
      "content-type": blob.type || "image/jpeg",
      "x-width": String(Math.round(width)),
      "x-height": String(Math.round(height)),
      ...(await authHeaders()),
    },
    body: blob,
  });
  if (!res.ok) throw new Error(`Saving picture ${slot} failed: ${res.status}`);
}

export async function removePhoto(ref: ProjectRef, slot: string): Promise<void> {
  if (ref.kind === "local") {
    await localPhotos.remove(ref.id, slot);
    return;
  }
  const url = serverUrl(`/projects/${ref.id}/photos/${slot}`);
  if (!url) return;
  const res = await fetch(url, { method: "DELETE", headers: await authHeaders() });
  if (!res.ok) throw new Error(`Removing picture ${slot} failed: ${res.status}`);
}

export async function photoSlots(ref: ProjectRef): Promise<PhotoSlot[]> {
  if (ref.kind === "local") return localPhotos.list(ref.id);
  const url = serverUrl(`/projects/${ref.id}/photos`);
  if (!url) return [];
  const res = await fetch(url, { headers: await authHeaders() });
  return res.ok ? ((await res.json()) as PhotoSlot[]) : [];
}

/** A picture as a blob URL the caller frees, or null when there is none. */
export async function photoUrl(ref: ProjectRef, slot: string): Promise<string | null> {
  if (ref.kind === "local") {
    const photo = await localPhotos.get(ref.id, slot);
    return photo ? URL.createObjectURL(photo.blob) : null;
  }
  const url = serverUrl(`/projects/${ref.id}/photos/${slot}`);
  if (!url) return null;
  const res = await fetch(url, { headers: await authHeaders() });
  return res.ok ? URL.createObjectURL(await res.blob()) : null;
}

/** The card picture of a project: its facade photo, else its 3D view, else nothing. */
export async function cardPicture(ref: ProjectRef): Promise<string | null> {
  // The building in 3D when there is one, else the facade photo.
  return (await photoUrl(ref, "model")) ?? (await photoUrl(ref, "thumbnail"));
}

/**
 * A small copy of an image, `maxSide` pixels on its long side, for a card: a JPEG, or a WebP
 * when it must keep its transparency.
 */
export async function shrinkImage(
  source: Blob,
  maxSide = 480,
  type: "image/jpeg" | "image/webp" = "image/jpeg",
): Promise<{ blob: Blob; width: number; height: number } | null> {
  if (typeof createImageBitmap === "undefined") return null;
  const bitmap = await createImageBitmap(source);
  const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height));
  const width = Math.max(1, Math.round(bitmap.width * scale));
  const height = Math.max(1, Math.round(bitmap.height * scale));
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  canvas.getContext("2d")?.drawImage(bitmap, 0, 0, width, height);
  bitmap.close();
  const blob = await new Promise<Blob | null>((resolve) => {
    canvas.toBlob(resolve, type, 0.82);
  });
  return blob ? { blob, width, height } : null;
}
