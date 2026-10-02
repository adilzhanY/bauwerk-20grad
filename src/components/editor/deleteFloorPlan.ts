import { currentProjectRef, removePhoto } from "@/projects/projects";
import { useEditorStore } from "@/store/building";

/**
 * Takes a storey's floor plan drawing off, here and from the project, so it goes for everyone
 * (the server tells the other tabs the files changed, photoSync takes it off there). The walls,
 * doors and rooms read from it stay: they are the model now.
 */
export function deleteFloorPlan(storeyId: string): void {
  useEditorStore.getState().setFloorPlanImage(storeyId, null);
  const ref = currentProjectRef();
  if (ref) void removePhoto(ref, `plan-${storeyId}`).catch(() => undefined);
}
