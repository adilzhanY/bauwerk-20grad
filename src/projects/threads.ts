/**
 * The threads of the open server project (TODO Part 21, CE), kept apart from the editor store:
 * they are conversation, not the building, so they never enter its history. Loaded when a
 * project opens and again whenever the server says they changed ("threads" on the socket,
 * passed on as the window event `bauwerk:threads`).
 */
import { create } from "zustand";
import { useEditorStore } from "@/store/building";
import { listThreads } from "./collab";
import type { Thread } from "./collab";

interface ThreadsState {
  projectId: string | null;
  threads: Thread[];
}

export const useThreads = create<ThreadsState>(() => ({ projectId: null, threads: [] }));

export const THREADS_EVENT = "bauwerk:threads";

let loading = 0;

/** Fetches the threads of the project now open; a newer load wins over an older one. */
export async function reloadThreads(): Promise<void> {
  const projectId = useEditorStore.getState().projectId;
  const ticket = ++loading;
  if (!projectId) {
    useThreads.setState({ projectId: null, threads: [] });
    return;
  }
  try {
    const threads = await listThreads(projectId);
    if (ticket === loading) useThreads.setState({ projectId, threads });
  } catch {
    // Offline or no access: the threads shown stay until the next change.
  }
}

let started = false;

/** Call once at start: follows the open project and the server's change messages. */
export function startThreads(): void {
  if (started) return;
  started = true;
  useEditorStore.subscribe((state, prev) => {
    if (state.projectId !== prev.projectId) void reloadThreads();
  });
  window.addEventListener(THREADS_EVENT, () => {
    void reloadThreads();
  });
}
