import { currentProjectRef, removePhoto } from "@/projects/projects";
import { useEditorStore } from "@/store/building";

/**
 * Takes a storey's floor plan drawing off, here and from the project, so it goes for everyone
 * (the server tells the other tabs the files changed, photoSync takes it off there). With
 * `interiors`, the storey's interior walls and doors go too (one undo step); without, they stay
 * in the model.
 */
export function deleteFloorPlan(storeyId: string, interiors = false): void {
  const state = useEditorStore.getState();
  state.setFloorPlanImage(storeyId, null);
  if (interiors) state.clearInteriors(storeyId);
  const ref = currentProjectRef();
  if (ref) void removePhoto(ref, `plan-${storeyId}`).catch(() => undefined);
}
