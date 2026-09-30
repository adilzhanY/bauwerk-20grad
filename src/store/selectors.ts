import type { EditorStore, Selection } from "./building";
import type { Building, Id, Storey } from "@/geometry/types";

/** True when the selected element is still present in the building. */
export function selectionExists(building: Building, selection: Selection | null): boolean {
  if (!selection) return false;
  const storey = (id: Id) => building.storeys.find((s) => s.id === id);
  switch (selection.kind) {
    case "vertex":
      return selection.index >= 0 && selection.index < building.footprint.length;
    case "wall":
      return (
        storey(selection.storeyId) !== undefined &&
        selection.wallIndex >= 0 &&
        selection.wallIndex < building.footprint.length
      );
    case "opening":
      return storey(selection.storeyId)?.openings.some((o) => o.id === selection.id) ?? false;
    case "interiorWall": {
      const s = storey(selection.storeyId);
      return s !== undefined && selection.index >= 0 && selection.index < s.interiorWalls.length;
    }
    case "room":
      return storey(selection.storeyId)?.rooms.some((r) => r.id === selection.id) ?? false;
    case "storey":
      return storey(selection.id) !== undefined;
    case "zone":
      return building.zones.some((z) => z.id === selection.id);
    case "roof":
      return true;
    case "radiator":
      return storey(selection.storeyId)?.radiators?.some((r) => r.id === selection.id) ?? false;
    case "heatPump":
      return building.heatPumps?.some((h) => h.id === selection.id) ?? false;
    case "pipe":
      return storey(selection.storeyId)?.pipes?.some((p) => p.id === selection.id) ?? false;
    case "measurement":
      return storey(selection.storeyId)?.measurements?.some((m) => m.id === selection.id) ?? false;
  }
}

export const selectActiveStorey = (state: EditorStore): Storey | undefined =>
  state.building.storeys.find((s) => s.id === state.activeStoreyId);

export const selectCanUndo = (state: EditorStore): boolean => state.past.length > 0;
export const selectCanRedo = (state: EditorStore): boolean => state.future.length > 0;

/** Height of the storey floor above the ground, the sum of the storeys below it. */
export function storeyElevation(building: Building, storeyId: Id): number {
  let y = 0;
  for (const s of building.storeys) {
    if (s.id === storeyId) return y;
    y += s.height;
  }
  return y;
}

export const selectTotalHeight = (state: EditorStore): number =>
  state.building.storeys.reduce((sum, s) => sum + s.height, 0);

export const selectRoomCount = (state: EditorStore): number =>
  state.building.storeys.reduce((sum, s) => sum + s.rooms.length, 0);

export const selectTotalFloorArea = (state: EditorStore): number =>
  state.building.storeys.reduce((sum, s) => sum + s.rooms.reduce((a, r) => a + r.area, 0), 0);
