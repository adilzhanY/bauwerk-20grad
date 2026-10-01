/**
 * The project the editor works on, from start to save. A project exists only once it was
 * saved: until then the work lives in this tab alone, and leaving it asks whether to save.
 * After the first Save a server project syncs live with everyone in it, and a project in
 * this browser keeps every change, so there is nothing more to save by hand.
 *
 * Every new project starts from the building it is given and nothing else: no copy kept for
 * the same house, no photos or floor plans of the project open before, no undo back into it.
 * The page before 2026-09-29 kept every building opened by its id, and a new project of the
 * same house came back with the old one's floor plan.
 */
import { create } from "zustand";
import type { Route } from "@/app/router";
import { setLeaveGuard } from "@/app/router";
import type { Building } from "@/geometry/types";
import { randomId } from "@/lib/ids";
import { loadProjectCopy, saveProjectCopy } from "@/lib/storage";
import { createDefaultBuilding, useEditorStore } from "@/store/building";
import {
  createProject,
  leaveProject,
  openProject,
  projectIdFromUrl,
  syncEnabled,
  whenJoined,
} from "@/sync/useSync";
import { currentProjectRef, projectRefOf, sameRef } from "./projects";
import type { ProjectCard } from "./projects";

type EditorState = ReturnType<typeof useEditorStore.getState>;

/**
 * Whether the editor holds work that is not saved in a project: a project started and not
 * saved yet, or a building without a project that was changed.
 */
export function isUnsaved(state: EditorState = useEditorStore.getState()): boolean {
  // The project in the address counts too: the connection to it closes on pages without the
  // editor, and the project is still saved.
  if (projectRefOf(state) !== null || (syncEnabled && projectIdFromUrl() !== null)) return false;
  return state.building.project !== undefined || state.past.length > 0;
}

/**
 * Puts `building` in the editor as it is: leaves the open project, drops its photos and floor
 * plans and its undo steps. The one way a building replaces another in the editor.
 */
export function openBuilding(building: Building): void {
  leaveProject();
  const store = useEditorStore.getState();
  store.clearProjectMedia();
  store.loadBuilding(building);
  store.clearHistory();
}

/** Starts a new, unsaved project with `building`. */
export const startProject = openBuilding;

/**
 * Replaces the work with a new, unsaved project of `building` (an example, a box from New
 * building), asking first whether to save unsaved work. The project open before is left, so
 * the new building never reaches it as an edit. Resolves false when the user chose to stay.
 */
export async function startNewProject(building: Building): Promise<boolean> {
  if (!(await confirmLeave())) return false;
  startProject(building);
  return true;
}

/** Throws the unsaved work away: the editor goes back to an empty building. */
export function discardProject(): void {
  openBuilding(createDefaultBuilding(useEditorStore.getState().language));
}

/**
 * Saves the work as a project: on the server, where it syncs live from now on, or in this
 * browser under its own id. The photos and floor plan images go with it (photoSync.ts).
 * Resolves false when the server refused, and the work stays unsaved.
 */
export function saveProject(): Promise<boolean> {
  // Ctrl+S, Share and the leave dialog can all ask while the server is still creating it.
  saving ??= save().finally(() => {
    saving = null;
  });
  return saving;
}

let saving: Promise<boolean> | null = null;

async function save(): Promise<boolean> {
  const store = useEditorStore.getState();
  if (projectRefOf(store) !== null) return true;
  // The project facts mark a building as a project, also one drawn by hand.
  if (!store.building.project) store.setProjectInfo({});
  if (syncEnabled) {
    // A copy kept in this browser becomes the server project and stops being kept here.
    if (store.building.project?.localId) store.setProjectInfo({ localId: undefined });
    const id = await createProject().catch(() => null);
    if (!id) return false;
    openProject(id);
    // Known at once, so the work counts as saved even before the editor page connects.
    useEditorStore.getState().setProjectId(id);
    return true;
  }
  store.setProjectInfo({ localId: randomId() });
  saveProjectCopy(useEditorStore.getState().building);
  return true;
}

/**
 * Opens a building from its building page for work. A new project was asked for (`fresh`):
 * a new project of it. Otherwise the project already open, when it is of this house, goes on;
 * any other work is left first, asking whether to save it. `prepare` gives what the editor
 * should hold, for example with a photographed wall taken over. Resolves false when the user
 * chose to stay with the work open before.
 */
export async function openForWork(
  building: Building,
  prepare: (existing: Building) => Building = (b) => b,
  options: { fresh?: boolean } = {},
): Promise<boolean> {
  const store = useEditorStore.getState();
  const gid = prepare(building).project?.gid;
  const sameHouse = gid !== undefined && store.building.project?.gid === gid;
  if (sameHouse && !options.fresh) {
    const next = prepare(store.building);
    if (next !== store.building) store.loadBuilding(next);
    return true;
  }
  if (!(await confirmLeave())) return false;
  startProject(prepare(building));
  return true;
}

// Opening a saved project --------------------------------------------------------------

/** How opening a project ended: open, the user chose to stay with the work, or it failed. */
export type OpenResult = "opened" | "stayed" | "failed";

/** Opens a project from its card, asking first whether to save unsaved work. */
export async function openProjectCard(card: ProjectCard): Promise<OpenResult> {
  if (sameRef(currentProjectRef(), card.ref)) return "opened";
  if (card.ref.kind === "server") return openServerProject(card.ref.id);
  if (!(await confirmLeave())) return "stayed";
  const building = loadProjectCopy(card.ref.id);
  if (!building) return "failed";
  openBuilding(building);
  return "opened";
}

/**
 * Opens a server project by its id (a card, a notification) and waits until it has joined,
 * asking first whether to save unsaved work.
 */
export async function openServerProject(id: string): Promise<OpenResult> {
  if (useEditorStore.getState().projectId === id) return "opened";
  if (!(await confirmLeave())) return "stayed";
  // Nothing of the project open before may show while this one arrives.
  openBuilding(createDefaultBuilding(useEditorStore.getState().language));
  openProject(id);
  return whenJoined(id).then(
    () => "opened" as const,
    () => "failed" as const,
  );
}

// Leaving unsaved work ------------------------------------------------------------------

export type LeaveChoice = "save" | "discard" | "cancel";

interface LeaveState {
  /** While the "Save changes?" dialog is up: how to answer it. */
  answer: ((choice: LeaveChoice) => Promise<boolean>) | null;
}

/** The open question, for the dialog (SaveBeforeLeaveDialog). */
export const useLeave = create<LeaveState>(() => ({ answer: null }));

/**
 * Asks whether to save unsaved work before it is left, and resolves true once it may be
 * left (saved, or thrown away) or false to stay. Resolves true at once when nothing is
 * unsaved. The answer "save" resolves false when saving failed: the dialog stays and says so.
 */
export function confirmLeave(): Promise<boolean> {
  if (!isUnsaved()) return Promise.resolve(true);
  return new Promise((resolve) => {
    useLeave.setState({
      answer: async (choice) => {
        if (choice === "save" && !(await saveProject())) return false;
        if (choice === "discard") discardProject();
        useLeave.setState({ answer: null });
        resolve(choice !== "cancel");
        return true;
      },
    });
  });
}

/** Pages that belong to the open project: its building page and its steps. */
function insideProject(route: Route, gid: string | undefined): boolean {
  if (route.page === "building") return gid !== undefined && route.gid === gid;
  return route.page === "editor" || route.page === "variants" || route.page === "report";
}

/**
 * Asks before unsaved work is left: through the app's own links (the router's guard) and
 * by reloading or closing the tab (the browser's own question).
 */
export function startLeaveGuard(): () => void {
  setLeaveGuard((from, to) => {
    const gid = useEditorStore.getState().building.project?.gid;
    if (!insideProject(from, gid) || insideProject(to, gid) || !isUnsaved()) return true;
    return confirmLeave();
  });
  const beforeUnload = (e: BeforeUnloadEvent) => {
    if (!isUnsaved()) return;
    e.preventDefault();
  };
  // Ctrl+S (Cmd+S) saves on every page, instead of the browser saving the page as a file.
  const onKey = (e: KeyboardEvent) => {
    // Not e.key.toLowerCase(): the browser's autofill sends key events without a key.
    if ((e.key !== "s" && e.key !== "S") || !(e.ctrlKey || e.metaKey) || e.shiftKey || e.altKey)
      return;
    e.preventDefault();
    if (isUnsaved()) void saveProject();
  };
  window.addEventListener("beforeunload", beforeUnload);
  window.addEventListener("keydown", onKey);
  return () => {
    setLeaveGuard(null);
    window.removeEventListener("beforeunload", beforeUnload);
    window.removeEventListener("keydown", onKey);
  };
}
