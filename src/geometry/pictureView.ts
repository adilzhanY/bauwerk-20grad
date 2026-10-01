import { bounds, signedArea } from "./polygon";
import { sharedEdgeSet } from "./shared";
import type { Building, Vec2 } from "./types";

/** A camera for the project card's picture, in plan space; `h` is the height above ground. */
export interface PictureView {
  eye: { x: number; y: number; h: number };
  target: { x: number; y: number; h: number };
}

/** Turned this far from straight at the street facade, so a second side shows too. */
const TURN = (35 * Math.PI) / 180;
/** Looking down this far, so the roof shows. */
const PITCH = (24 * Math.PI) / 180;
/** A door says "street side" more than a window does. */
const DOOR_WEIGHT = 5;

/**
 * The footprint edge that faces the street, for the card picture to look at: the wall with a
 * facade photo (people photograph the street side), else the outside wall with the most
 * windows and doors (doors counting more), else the longest outside wall. Walls shared with a
 * neighbour never face the street.
 */
export function streetEdge(
  building: Pick<Building, "footprint" | "storeys" | "sharedEdges">,
  photoEdges: readonly number[] = [],
): number | null {
  const count = building.footprint.length;
  if (count < 3) return null;
  const shared = sharedEdgeSet(building);
  const outside = [...Array(count).keys()].filter((i) => !shared.has(i));
  const candidates = outside.length > 0 ? outside : [...Array(count).keys()];
  const photo = photoEdges.find((e) => candidates.includes(e));
  if (photo !== undefined) return photo;

  const score = new Map<number, number>();
  for (const storey of building.storeys) {
    for (const o of storey.openings) {
      if (o.interior) continue;
      score.set(o.wallIndex, (score.get(o.wallIndex) ?? 0) + (o.kind === "door" ? DOOR_WEIGHT : 1));
    }
  }
  const length = (i: number) => {
    const a = building.footprint[i] ?? { x: 0, y: 0 };
    const b = building.footprint[(i + 1) % count] ?? a;
    return Math.hypot(b.x - a.x, b.y - a.y);
  };
  return candidates.reduce((best, i) => {
    const diff = (score.get(i) ?? 0) - (score.get(best) ?? 0);
    return diff > 0 || (diff === 0 && length(i) > length(best)) ? i : best;
  });
}

/**
 * A three-quarter view of the whole building for its card picture: in front of footprint
 * edge `front` (the street side, streetEdge), turned to show the next side, from a little
 * above. Far enough that the building's bounding sphere fits the narrower of the two fields
 * of view (`fov` vertical, in degrees, and `aspect` width over height).
 */
export function pictureView(
  footprint: readonly Vec2[],
  front: number,
  height: number,
  fov = 30,
  aspect = 4 / 3,
): PictureView | null {
  const a = footprint[front];
  const b = footprint[(front + 1) % footprint.length];
  if (footprint.length < 3 || !a || !b) return null;
  const length = Math.hypot(b.x - a.x, b.y - a.y) || 1;
  const dx = (b.x - a.x) / length;
  const dy = (b.y - a.y) / length;
  // The outside of an edge is on its right in a counter-clockwise ring, else on its left.
  const ccw = signedArea(footprint) > 0;
  const out = ccw ? Math.atan2(-dx, dy) : Math.atan2(dx, -dy);
  const facing = out + (ccw ? TURN : -TURN);

  const { min, max } = bounds(footprint);
  const target = { x: (min.x + max.x) / 2, y: (min.y + max.y) / 2, h: height / 2 };
  const radius = Math.hypot(max.x - min.x, max.y - min.y, height) / 2;
  const half = (fov * Math.PI) / 360;
  const narrow = Math.min(half, Math.atan(Math.tan(half) * aspect));
  const distance = (radius / Math.sin(narrow)) * 1.04;
  return {
    eye: {
      x: target.x + Math.cos(facing) * Math.cos(PITCH) * distance,
      y: target.y + Math.sin(facing) * Math.cos(PITCH) * distance,
      h: target.h + Math.sin(PITCH) * distance,
    },
    target,
  };
}
