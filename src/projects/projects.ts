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
import { authHeaders } from "@/auth/api";
import { projectSummary } from "@/geometry/project";
import type { ProjectSummary as CardSummary } from "@/geometry/project";
import type { Building, ProjectInfo } from "@/geometry/types";
import { listProjectCopies, loadProjectCopy, removeProjectCopy } from "@/lib/storage";
import { createDefaultBuilding, useEditorStore } from "@/store/building";
import { openBuilding } from "./session";
import { syncConfigFromEnv } from "@/sync/client";
import { leaveProject, listProjects, openProject, syncEnabled, whenJoined } from "@/sync/useSync";
import { localPhotos } from "./localPhotos";

export type ProjectRef = { kind: "server"; id: string } | { kind: "local"; id: string };

export interface ProjectCard {
  ref: ProjectRef;
  buildingId: string;
  summary: CardSummary;
  updatedAt: string;
  /** People who work on it, when accounts are on. */
  owner: string | null;
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
  }));
}

/** The saved project an editor state has open, or null while its work is not saved. */
export function projectRefOf(state: {
  projectId: string | null;
  building: Building;
}): ProjectRef | null {
  if (state.projectId) return { kind: "server", id: state.projectId };
  const localId = state.building.project?.localId;
  return localId ? { kind: "local", id: localId } : null;
}

/** The project open in the editor, or null when the editor holds a loose building. */
export function currentProjectRef(): ProjectRef | null {
  return projectRefOf(useEditorStore.getState());
}

/** Opens a project in the editor: joins it on the server, or loads its kept building. */
export async function openProjectCard(card: ProjectCard): Promise<void> {
  if (sameRef(currentProjectRef(), card.ref)) return;
  leaveProject();
  if (card.ref.kind === "server") {
    // Nothing of the project open before may show while this one arrives.
    openBuilding(createDefaultBuilding(useEditorStore.getState().language));
    openProject(card.ref.id);
    await whenJoined(card.ref.id);
    return;
  }
  const building = loadProjectCopy(card.ref.id);
  if (building) openBuilding(building);
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
}

function serverUrl(path: string): string | null {
  const cfg = syncConfigFromEnv();
  return cfg ? `${cfg.apiUrl}${path}` : null;
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
  await fetch(url, {
    method: "PUT",
    headers: {
      "content-type": blob.type || "image/jpeg",
      "x-width": String(Math.round(width)),
      "x-height": String(Math.round(height)),
      ...(await authHeaders()),
    },
    body: blob,
  });
}

export async function removePhoto(ref: ProjectRef, slot: string): Promise<void> {
  if (ref.kind === "local") {
    await localPhotos.remove(ref.id, slot);
    return;
  }
  const url = serverUrl(`/projects/${ref.id}/photos/${slot}`);
  if (url) await fetch(url, { method: "DELETE", headers: await authHeaders() });
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
  return (await photoUrl(ref, "thumbnail")) ?? (await photoUrl(ref, "model"));
}

/** A small JPEG of an image, `maxSide` pixels on its long side, for a card. */
export async function shrinkImage(
  source: Blob,
  maxSide = 480,
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
    canvas.toBlob(resolve, "image/jpeg", 0.82);
  });
  return blob ? { blob, width, height } : null;
}
