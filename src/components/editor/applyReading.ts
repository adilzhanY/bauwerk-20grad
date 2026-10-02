import { floorPlanEdits } from "@/geometry/floorPlanImport";
import type { FloorPlanReading } from "@/lod2/api/floorplan";
import { useEditorStore } from "@/store/building";

const xy = (p: [number, number]) => ({ x: p[0], y: p[1] });

/**
 * Puts what the AI read from a floor plan onto a storey: its interior walls, doors and rooms
 * as one undo step, and the drawing as the storey's floor plan picture, which goes with the
 * project. `url` is the drawing's object URL; the store keeps it from here on.
 */
export function applyReading(
  storeyId: string,
  reading: FloorPlanReading,
  url: string,
): { walls: number; doors: number; rooms: number } {
  const state = useEditorStore.getState();
  const storey = state.building.storeys.find((s) => s.id === storeyId);
  if (!storey) return { walls: 0, doors: 0, rooms: 0 };
  const edits = floorPlanEdits(
    reading.walls.map((w) => ({ a: xy(w.a), b: xy(w.b), thickness: w.thickness })),
    reading.doors.map((d) => ({ a: xy(d.a), b: xy(d.b) })),
    state.building.footprint,
    storey.height,
    state.building.constructions,
  );
  state.applyFloorPlan(storeyId, edits);
  const [width, height] = reading.imageSize;
  state.setFloorPlanImage(storeyId, { url, width, height });
  const rooms = useEditorStore.getState().building.storeys.find((s) => s.id === storeyId);
  return {
    walls: edits.interiorWalls.length,
    doors: edits.doors.length,
    rooms: rooms?.rooms.length ?? 0,
  };
}
