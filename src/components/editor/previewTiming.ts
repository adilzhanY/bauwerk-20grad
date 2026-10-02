import type { FloorPlanReading } from "@/lod2/api/floorplan";

/** The reveal of a result: one wall after another, then the doors. */
export const WALL_STAGGER_MS = 120;
export const DOOR_STAGGER_MS = 70;
/** How long one line takes to draw in or pop (the ai-draw and ai-pop animations in ai.css). */
const LINE_MS = 600;

/** How long the preview of a reading takes to arrive in full. */
export function previewMs(reading: FloorPlanReading): number {
  return reading.walls.length * WALL_STAGGER_MS + reading.doors.length * DOOR_STAGGER_MS + LINE_MS;
}
