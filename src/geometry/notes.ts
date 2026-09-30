/**
 * Notes on the building: which element a note is about, whether that element still exists,
 * and where its pin stands in 3D (plan point and height). Pure.
 */
import { centroid, edges } from "./polygon";
import type { Building, Note, NoteTarget, Vec2 } from "./types";

export function sameTarget(a: NoteTarget, b: NoteTarget): boolean {
  switch (a.kind) {
    case "building":
      return b.kind === "building";
    case "wall":
      return b.kind === "wall" && b.wallIndex === a.wallIndex;
    case "storey":
      return b.kind === "storey" && b.id === a.id;
    case "opening":
    case "room":
      return b.kind === a.kind && b.storeyId === a.storeyId && b.id === a.id;
  }
}

/** The element is still there. A note on a deleted one is shown with the building. */
export function targetExists(building: Building, target: NoteTarget): boolean {
  switch (target.kind) {
    case "building":
      return true;
    case "wall":
      return target.wallIndex >= 0 && target.wallIndex < building.footprint.length;
    case "storey":
      return building.storeys.some((s) => s.id === target.id);
    case "opening":
      return building.storeys.some(
        (s) => s.id === target.storeyId && s.openings.some((o) => o.id === target.id),
      );
    case "room":
      return building.storeys.some(
        (s) => s.id === target.storeyId && s.rooms.some((r) => r.id === target.id),
      );
  }
}

/** The notes about `target`; for the building, also those whose element is gone. */
export function notesAbout(building: Building, target: NoteTarget): Note[] {
  return (building.notes ?? []).filter(
    (n) =>
      sameTarget(n.target, target) ||
      (target.kind === "building" && !targetExists(building, n.target)),
  );
}

/** Where the pin of a note on `target` stands: a plan point and a height, metres. */
export function pinPosition(
  building: Building,
  target: NoteTarget,
): { point: Vec2; height: number } | null {
  if (!targetExists(building, target)) return null;
  const elevations = building.storeys.map((_, i) =>
    building.storeys.slice(0, i).reduce((sum, s) => sum + s.height, 0),
  );
  const eaves = building.storeys.reduce((sum, s) => sum + s.height, 0);
  const outside = (edgeIndex: number, along: number) => {
    const edge = edges(building.footprint)[edgeIndex];
    if (!edge) return null;
    return {
      x: edge.a.x + edge.direction.x * along + edge.normal.x * 0.4,
      y: edge.a.y + edge.direction.y * along + edge.normal.y * 0.4,
    };
  };
  switch (target.kind) {
    case "building":
      return { point: centroid(building.footprint), height: eaves + 1.5 };
    case "wall": {
      const edge = edges(building.footprint)[target.wallIndex];
      const point = edge ? outside(target.wallIndex, edge.length / 2) : null;
      return point ? { point, height: eaves / 2 } : null;
    }
    case "storey": {
      const index = building.storeys.findIndex((s) => s.id === target.id);
      const storey = building.storeys[index];
      return storey
        ? {
            point: centroid(building.footprint),
            height: (elevations[index] ?? 0) + storey.height / 2,
          }
        : null;
    }
    case "opening": {
      const index = building.storeys.findIndex((s) => s.id === target.storeyId);
      const opening = building.storeys[index]?.openings.find((o) => o.id === target.id);
      if (!opening) return null;
      if (opening.interior) {
        const segment = building.storeys[index]?.interiorWalls[opening.wallIndex];
        if (!segment) return null;
        return {
          point: { x: (segment.a.x + segment.b.x) / 2, y: (segment.a.y + segment.b.y) / 2 },
          height: (elevations[index] ?? 0) + opening.sill + opening.height + 0.3,
        };
      }
      const point = outside(opening.wallIndex, opening.offset + opening.width / 2);
      return point
        ? { point, height: (elevations[index] ?? 0) + opening.sill + opening.height + 0.3 }
        : null;
    }
    case "room": {
      const index = building.storeys.findIndex((s) => s.id === target.storeyId);
      const room = building.storeys[index]?.rooms.find((r) => r.id === target.id);
      return room && room.polygon.length > 0
        ? { point: centroid(room.polygon), height: (elevations[index] ?? 0) + 1.2 }
        : null;
    }
  }
}
