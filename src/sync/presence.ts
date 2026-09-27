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

interface Listener {
  cursor: (point: Vec2 | null) => void;
  drag: (drag: DragPreview | null) => void;
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
