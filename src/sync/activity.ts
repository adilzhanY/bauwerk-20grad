/**
 * Big moments in a shared project, announced to the others for a short toast: a floor plan
 * applied on a storey, a facade's openings put on a wall, a version restored. The change
 * itself travels as ops like every edit; this only says who did it and where, so the others
 * notice. Never shown to the person who did it.
 */
export type Activity =
  | { kind: "floorPlan"; storeyId: string }
  | { kind: "facade"; wallIndex: number; count: number }
  | { kind: "restore"; version: number };

export interface ActivityEvent {
  actor: string;
  userId: string | null;
  activity: Activity;
}

let sender: ((activity: Activity) => void) | null = null;
const watchers = new Set<(event: ActivityEvent) => void>();

/** The project connection sets this while it is joined; without it nothing is sent. */
export function setActivitySender(next: ((activity: Activity) => void) | null): void {
  sender = next;
}

/** Tells the others in the project, if this tab is in a shared one. */
export function shareActivity(activity: Activity): void {
  sender?.(activity);
}

/** Calls `watcher` with every activity of someone else that arrives. */
export function watchActivity(watcher: (event: ActivityEvent) => void): () => void {
  watchers.add(watcher);
  return () => {
    watchers.delete(watcher);
  };
}

export function receiveActivity(event: ActivityEvent): void {
  for (const watcher of watchers) watcher(event);
}
