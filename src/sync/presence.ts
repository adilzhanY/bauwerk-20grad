/**
 * Where this tab's pointer is and what it is dragging, on their way to the others.
 *
 * Pointer moves come many times a second. They go straight to the sync client through this
 * channel instead of through the editor store, so they never make every component re-run
 * its selectors. Without a shared project nobody listens and the calls cost nothing.
 */
import type { Id, Vec2 } from "@/geometry/types";

/** An opening being dragged along its wall, with where it is right now. */
export interface DragPreview {
  storeyId: Id;
  id: Id;
  offset: number;
}

/** Where a tab's camera is: world position and orbit target, and the storey it shows. */
export interface SharedView {
  position: [number, number, number];
  target: [number, number, number];
  storeyId: string | null;
}

interface Listener {
  cursor: (point: Vec2 | null) => void;
  drag: (drag: DragPreview | null) => void;
  view: (view: SharedView) => void;
}

let listener: Listener | null = null;

export function listenPresence(next: Listener | null): void {
  listener = next;
}

/** The pointer on the ground, in plan metres, or null when it left the view. */
export function shareCursor(point: Vec2 | null): void {
  listener?.cursor(point);
}

export function shareDrag(drag: DragPreview | null): void {
  listener?.drag(drag);
}

/** This tab's camera, for whoever follows it (TODO Part 21, CC.5). */
export function shareView(view: SharedView): void {
  listener?.view(view);
}

type ViewWatcher = (clientId: string, view: SharedView) => void;
const viewWatchers = new Set<ViewWatcher>();

/** Calls `watcher` with every other tab's camera as it arrives. */
export function watchViews(watcher: ViewWatcher): () => void {
  viewWatchers.add(watcher);
  return () => {
    viewWatchers.delete(watcher);
  };
}

export function receiveView(clientId: string, view: SharedView): void {
  for (const watcher of viewWatchers) watcher(clientId, view);
}
