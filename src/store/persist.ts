import {
  applyTheme,
  rememberOpenProject,
  saveLanguage,
  saveProjectCopy,
  saveTheme,
} from "@/lib/storage";
import type { createEditorStore } from "./building";

const SAVE_DELAY_MS = 300;

/**
 * Keeps the language and theme, and, without a server, a saved project: once a project has
 * been saved (it has a local id) its changes are kept as they happen, the way a server
 * project syncs live. A building that was never saved is kept nowhere; leaving it asks.
 */
export function startPersistence(store: ReturnType<typeof createEditorStore>): () => void {
  let timer: ReturnType<typeof setTimeout> | null = null;
  applyTheme(store.getState().theme);
  return store.subscribe((state, previous) => {
    if (state.language !== previous.language) saveLanguage(state.language);
    if (state.theme !== previous.theme) {
      saveTheme(state.theme);
      applyTheme(state.theme);
    }
    if (state.building !== previous.building) {
      const id = state.building.project?.localId ?? null;
      if (id !== (previous.building.project?.localId ?? null)) {
        rememberOpenProject(id);
        // The project left keeps its last change now: a save still waiting could otherwise
        // bring it back after it was deleted (projects/session.ts deleteProject).
        if (timer) {
          clearTimeout(timer);
          timer = null;
          saveProjectCopy(previous.building);
        }
      }
      if (!id) return;
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        timer = null;
        saveProjectCopy(state.building);
      }, SAVE_DELAY_MS);
    }
  });
}
