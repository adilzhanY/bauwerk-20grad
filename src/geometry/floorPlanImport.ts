/**
 * A floor plan read by the floor plan service (lod2/lod2-floorplan), turned into edits of one
 * storey: its interior walls, and its doors as openings in those walls.
 *
 * The service already fitted the plan into the building's outline, so everything arrives in
 * plan metres. What is left is Bauwerk's own shape of the data: a wall is a segment on the
 * storey, a door is an interior opening on one of those segments, at an offset from the
 * segment's start. Measurements are kept to the centimetre, the precision of the drawing.
 * A wall the service measured gets the wall type nearest its drawn thickness.
 */
import { nearestInteriorWallType } from "./constructions";
import { defaultOpening, validateOpening } from "./openings";
import { distance, dot, sub } from "./polygon";
import type { Construction, InteriorWall, Opening, Segment, Vec2 } from "./types";

export interface PlanWall {
  a: Vec2;
  b: Vec2;
  /** Metres between its drawn faces, when the service measured it. */
  thickness?: number;
}

export interface PlanDoor {
  a: Vec2;
  b: Vec2;
}

export interface FloorPlanDoor {
  /** Index into the edits' `interiorWalls`. */
  wallIndex: number;
  /** Metres from the wall segment's start to the door's near edge. */
  offset: number;
  width: number;
}

export interface FloorPlanEdits {
  interiorWalls: InteriorWall[];
  doors: FloorPlanDoor[];
  /** Doors the service found that fit no wall or overlap another door, left out. */
  skippedDoors: number;
}

/** A door belongs to a wall when both its ends lie this close to the wall's line. */
const ON_WALL = 0.15;
/** Shorter walls and narrower doors are drawing noise, not building parts. */
const MIN_WALL = 0.3;
const MIN_DOOR = 0.4;
/** A wall end this close to another wall or the outline meets it. */
const WELD = 0.06;

const cm = (v: number) => Math.round(v * 100) / 100;
const point = (p: Vec2): Vec2 => ({ x: cm(p.x), y: cm(p.y) });

/** Distance from `p` to segment `s`, and how far along `s` its foot lies (metres from `s.a`). */
function onSegment(p: Vec2, s: Segment): { distance: number; along: number } {
  const d = sub(s.b, s.a);
  const length = Math.hypot(d.x, d.y);
  const along = length > 0 ? dot(sub(p, s.a), d) / length : 0;
  const t = Math.min(Math.max(along / Math.max(length, 1e-9), 0), 1);
  const foot = { x: s.a.x + d.x * t, y: s.a.y + d.y * t };
  return { distance: distance(p, foot), along };
}

/** Where `p` lands when moved straight onto segment `s`. */
function foot(p: Vec2, s: Segment): Vec2 {
  const d = sub(s.b, s.a);
  const lengthSq = d.x * d.x + d.y * d.y;
  const t = lengthSq > 0 ? Math.min(Math.max(dot(sub(p, s.a), d) / lengthSq, 0), 1) : 0;
  return { x: s.a.x + d.x * t, y: s.a.y + d.y * t };
}

/**
 * Wall ends moved exactly onto the wall or outline edge they meet. Rooms are the faces the
 * walls enclose, and a wall that stops a few millimetres short of another, as rounding to the
 * centimetre leaves it, closes no room.
 */
function welded(walls: InteriorWall[], footprint: readonly Vec2[]): InteriorWall[] {
  const outline: Segment[] = footprint.map((p, i) => ({
    a: p,
    b: footprint[(i + 1) % footprint.length] ?? p,
  }));
  const out = walls.map((w) => ({ ...w, a: { ...w.a }, b: { ...w.b } }));
  // Moving one end can shift the wall another end was welded to, so repeat until nothing
  // moves; every pass projects onto the walls as they are now.
  for (let pass = 0; pass < 10; pass++) {
    let moved = 0;
    out.forEach((wall, i) => {
      for (const end of ["a", "b"] as const) {
        const p = wall[end];
        let best: Vec2 | null = null;
        for (const other of [...outline, ...out.filter((_, j) => j !== i)]) {
          const q = foot(p, other);
          if (distance(p, q) <= WELD && (best === null || distance(p, q) < distance(p, best)))
            best = q;
        }
        if (best) {
          moved = Math.max(moved, distance(p, best));
          wall[end] = best;
        }
      }
    });
    if (moved < 1e-12) break;
  }
  return out;
}

/** The storey edits for the walls and doors of a read plan, inside `footprint`. */
export function floorPlanEdits(
  walls: readonly PlanWall[],
  doors: readonly PlanDoor[],
  footprint: readonly Vec2[],
  storeyHeight: number,
  /** The building's constructions, to pick each measured wall's type from. */
  constructions: readonly Construction[],
): FloorPlanEdits {
  const interiorWalls = welded(
    walls
      .filter((w) => distance(w.a, w.b) >= MIN_WALL)
      .map((w): InteriorWall => {
        const wall = { a: point(w.a), b: point(w.b) };
        if (w.thickness === undefined || w.thickness <= 0) return wall;
        return { ...wall, constructionId: nearestInteriorWallType(constructions, w.thickness).id };
      }),
    footprint,
  );

  const placed: FloorPlanDoor[] = [];
  let skippedDoors = 0;
  for (const door of doors) {
    let best: { wallIndex: number; from: number; to: number; off: number } | null = null;
    interiorWalls.forEach((wall, wallIndex) => {
      const a = onSegment(door.a, wall);
      const b = onSegment(door.b, wall);
      const off = Math.max(a.distance, b.distance);
      if (off <= ON_WALL && (best === null || off < best.off)) {
        best = { wallIndex, from: Math.min(a.along, b.along), to: Math.max(a.along, b.along), off };
      }
    });
    const found = best as { wallIndex: number; from: number; to: number } | null;
    if (!found) {
      skippedDoors++;
      continue;
    }
    const wall = interiorWalls[found.wallIndex];
    if (!wall) continue;
    const wallLength = distance(wall.a, wall.b);
    const offset = cm(Math.max(0, found.from));
    const width = cm(Math.min(found.to, wallLength) - offset);
    const candidate: FloorPlanDoor = { wallIndex: found.wallIndex, offset, width };
    const siblings = placed
      .filter((d) => d.wallIndex === found.wallIndex)
      .map((d, i) => asOpening(d, `placed-${String(i)}`));
    const problems = validateOpening(asOpening(candidate, "new"), {
      wallLength,
      storeyHeight,
      siblings,
    });
    if (width < MIN_DOOR || problems.length > 0) {
      skippedDoors++;
      continue;
    }
    placed.push(candidate);
  }
  return { interiorWalls, doors: placed, skippedDoors };
}

/** A placed door as the interior opening the editor stores. */
export function asOpening(door: FloorPlanDoor, id: string): Opening {
  return {
    ...defaultOpening("door"),
    id,
    wallIndex: door.wallIndex,
    interior: true,
    offset: door.offset,
    width: door.width,
    constructionId: "",
  };
}
