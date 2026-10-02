import type { Building } from "@/geometry/types";
import type { SharedView } from "@/sync/presence";
import { useEditorStore } from "@/store/building";
import { storeyElevation } from "@/store/selectors";

/** A view is sent again after this long even when it did not change, for someone who just
 * started following: otherwise they wait until the person they follow moves. */
export const RESEND_MS = 1000;
/** Camera changes smaller than this (metres) are not sent. */
const MOVED = 0.01;

/** What the last sent view was, to tell whether this one is worth sending. */
export interface Sent {
  view: SharedView | null;
  at: number;
}

const far = (a: [number, number, number], b: [number, number, number]) =>
  Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]) >= MOVED;

/** Whether this tab's view goes out now: it changed, or it has not gone out for a while. */
export function shouldShare(sent: Sent, view: SharedView, now: number): boolean {
  const last = sent.view;
  if (!last || now - sent.at >= RESEND_MS) return true;
  return (
    far(last.position, view.position) ||
    far(last.target, view.target) ||
    last.storeyId !== view.storeyId ||
    (last.plan ?? false) !== (view.plan ?? false) ||
    (last.zoom ?? null) !== (view.zoom ?? null)
  );
}

/**
 * Takes over the followed person's storey and view mode (the 2D plan or the 3D view), so the
 * camera that follows is the same kind as theirs. The camera itself glides in FollowCamera.
 */
export function followView(view: SharedView): void {
  const store = useEditorStore.getState();
  if (view.storeyId && view.storeyId !== store.activeStoreyId) store.setActiveStorey(view.storeyId);
  const plan = view.plan === true;
  if (plan !== store.planView) store.setPlanView(plan);
}

/** The height a person's pointer is drawn at: the floor of the storey they are on. */
export function cursorHeight(building: Building, storeyId: string | null | undefined): number {
  if (!storeyId || !building.storeys.some((s) => s.id === storeyId)) return 0;
  return storeyElevation(building, storeyId);
}
