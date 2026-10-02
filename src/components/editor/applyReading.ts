import { floorPlanEdits } from "@/geometry/floorPlanImport";
import { roomNameHints } from "@/geometry/roomNames";
import type { FloorPlanReading } from "@/lod2/api/floorplan";
import { PLAN_REVEAL_MS } from "@/scene/planReveal";
import { useEditorStore } from "@/store/building";

const xy = (p: [number, number]) => ({ x: p[0], y: p[1] });

/**
 * Puts what the AI read from a floor plan onto a storey: its interior walls, doors and rooms
 * (named as the plan names them, else after the room model's room type) as one undo step, and the drawing as the storey's floor plan picture, which goes with the
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
  const roomNames = roomNameHints(
    reading.labels.map((l) => ({ ...l, at: xy(l.at) })),
    reading.roomKinds.map((k) => ({ ...k, at: xy(k.at) })),
    state.language,
  );
  state.applyFloorPlan(storeyId, { ...edits, roomNames });
  const [width, height] = reading.imageSize;
  state.setFloorPlanImage(storeyId, { url, width, height });
  const rooms = useEditorStore.getState().building.storeys.find((s) => s.id === storeyId);
  return {
    walls: edits.interiorWalls.length,
    doors: edits.doors.length,
    rooms: rooms?.rooms.length ?? 0,
  };
}

/**
 * Puts the readings of several storeys on, one storey after another, each in the plan view of
 * its storey while its reveal plays: the same arrival as one plan read on its own. Each storey
 * is its own undo step.
 */
export function applyInTurn(
  items: { storeyId: string; reading: FloorPlanReading; url: string }[],
): void {
  items.forEach((item, i) => {
    setTimeout(
      () => {
        const state = useEditorStore.getState();
        // A project left in the meantime has other storeys: nothing to put on.
        if (!state.building.storeys.some((s) => s.id === item.storeyId)) return;
        state.setActiveStorey(item.storeyId);
        state.setPlanView(true);
        applyReading(item.storeyId, item.reading, item.url);
      },
      i * (PLAN_REVEAL_MS + TURN_PAUSE_MS),
    );
  });
}

/** A breath between one storey's reveal and the next. */
const TURN_PAUSE_MS = 300;
