import { withoutGuessedOpenings } from "@/geometry/sources";
import { EXPORT_VERSION, fromJson } from "@/geometry/export";
import type { ExportFile } from "@/geometry/export";
import type { Building } from "@/geometry/types";
import type { Language } from "@/i18n";
import type { Theme } from "@/store/building";
import { randomId } from "@/lib/ids";

const LANGUAGE_KEY = "bauwerk.language";
const THEME_KEY = "bauwerk.theme";

function storage(): Storage | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
}

export function loadLanguage(): Language | null {
  const v = storage()?.getItem(LANGUAGE_KEY);
  return v === "en" || v === "de" ? v : null;
}

export function saveLanguage(language: Language): void {
  storage()?.setItem(LANGUAGE_KEY, language);
}

/**
 * Saved projects, without a server: each one under its own id (`building.project.localId`),
 * set by its first Save. Nothing is kept for a building that was never saved as a project;
 * the page before 2026-09-29 kept every building opened, by building id, and a new project of
 * the same house came back with the old one's floor plan. ponytail: one localStorage entry
 * per project, no eviction; move to IndexedDB if projects outgrow localStorage's 5 MB.
 */
const PROJECT_KEY = "bauwerk.project.";
const OPEN_PROJECT_KEY = "bauwerk.openProject";
const LEGACY_KEY = "bauwerk.building";

function readFile(text: string | null): Building | null {
  if (!text) return null;
  const result = fromJson(text);
  // A building saved before facades without a photo stopped getting guessed windows.
  return result.ok ? withoutGuessedOpenings(result.building) : null;
}

/** Keeps a saved project's building; does nothing for a building that is not one. */
export function saveProjectCopy(building: Building): void {
  const id = building.project?.localId;
  if (!id) return;
  const file: ExportFile & { savedAt: string } = {
    format: "bauwerk",
    version: EXPORT_VERSION,
    building,
    savedAt: new Date().toISOString(),
  };
  try {
    storage()?.setItem(PROJECT_KEY + id, JSON.stringify(file));
  } catch {
    // Storage full: the project stays open in this tab; the next change tries again.
  }
}

export function loadProjectCopy(id: string): Building | null {
  return readFile(storage()?.getItem(PROJECT_KEY + id) ?? null);
}

export function removeProjectCopy(id: string): void {
  storage()?.removeItem(PROJECT_KEY + id);
  if (storage()?.getItem(OPEN_PROJECT_KEY) === id) storage()?.removeItem(OPEN_PROJECT_KEY);
}

/** Every saved project in this browser, newest first. */
export function listProjectCopies(): { building: Building; savedAt: string }[] {
  const store = storage();
  if (!store) return [];
  const out: { building: Building; savedAt: string }[] = [];
  for (let i = 0; i < store.length; i++) {
    const key = store.key(i);
    if (!key?.startsWith(PROJECT_KEY)) continue;
    const text = store.getItem(key);
    const building = readFile(text);
    if (!text || !building?.project?.localId) continue;
    const savedAt = (JSON.parse(text) as { savedAt?: unknown }).savedAt;
    out.push({
      building,
      savedAt: typeof savedAt === "string" ? savedAt : new Date(0).toISOString(),
    });
  }
  return out.sort((a, b) => b.savedAt.localeCompare(a.savedAt));
}

/** Which saved project the editor had open, so a reload opens it again. */
export function rememberOpenProject(id: string | null): void {
  if (id) storage()?.setItem(OPEN_PROJECT_KEY, id);
  else storage()?.removeItem(OPEN_PROJECT_KEY);
}

/**
 * The building the editor starts with: the saved project it had open, or none. First moves
 * what the page kept before projects were saved by hand: a building that was a project
 * becomes a saved one, everything else (the loose autosave, the copy of every building
 * opened) is dropped.
 */
export function initialBuilding(): Building | null {
  const store = storage();
  if (!store) return null;
  const legacy: string[] = [];
  for (let i = 0; i < store.length; i++) {
    const key = store.key(i);
    if (key === LEGACY_KEY || key?.startsWith(`${LEGACY_KEY}.`)) legacy.push(key);
  }
  for (const key of legacy) {
    const text = store.getItem(key);
    const building = key === LEGACY_KEY ? null : readFile(text);
    store.removeItem(key);
    if (building?.project) {
      saveProjectCopy({ ...building, project: { ...building.project, localId: randomId() } });
    }
  }
  const open = store.getItem(OPEN_PROJECT_KEY);
  return open ? loadProjectCopy(open) : null;
}

/**
 * After a crash: forgets which project was open and the edits waiting to be sent to a server
 * project, the two things read at start that can bring the crash back. Saved projects stay.
 */
export function resetLocalData(): void {
  const store = storage();
  if (!store) return;
  try {
    const queues = Array.from({ length: store.length }, (_, i) => store.key(i)).filter((key) =>
      key?.startsWith("bauwerk.queue."),
    );
    for (const key of [OPEN_PROJECT_KEY, ...queues]) if (key) store.removeItem(key);
  } catch {
    // Blocked storage holds nothing to reset.
  }
}

export function loadTheme(): Theme | null {
  const v = storage()?.getItem(THEME_KEY);
  return v === "light" || v === "dark" || v === "system" ? v : null;
}

export function saveTheme(theme: Theme): void {
  storage()?.setItem(THEME_KEY, theme);
}

/** Stamps data-theme on the root element; "system" removes it so the media query decides. */
export function applyTheme(theme: Theme): void {
  if (typeof document === "undefined") return;
  if (theme === "system") delete document.documentElement.dataset.theme;
  else document.documentElement.dataset.theme = theme;
}
