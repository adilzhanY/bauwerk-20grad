import { describe, expect, it } from "vitest";
import {
  DEFAULT_INTERIOR_WALL,
  PRESET_IDS,
  defaultConstructions,
  interiorWallThickness,
  interiorWallType,
  nearestInteriorWallType,
  withInteriorWallTypes,
} from "./constructions";
import { clearRoomPolygon } from "./plan";
import type { InteriorWall } from "./types";
import { normalizeWalls, pieceRange } from "./wallGraph";

const all = defaultConstructions("en");
const thicknessOf = interiorWallThickness(all);

describe("interior wall types", () => {
  it("are as thick as their layers, and a wall without a type is the 11.5 cm partition", () => {
    expect(thicknessOf({})).toBeCloseTo(0.115, 9);
    expect(thicknessOf({ constructionId: PRESET_IDS.interiorDrywall })).toBeCloseTo(0.1, 9);
    expect(thicknessOf({ constructionId: PRESET_IDS.interiorBearing24 })).toBeCloseTo(0.24, 9);
    expect(thicknessOf({ constructionId: PRESET_IDS.interiorBearing365 })).toBeCloseTo(0.365, 9);
    // A type that is gone, or not an interior wall, falls back to the default.
    expect(interiorWallType(all, { constructionId: "nope" }).id).toBe(DEFAULT_INTERIOR_WALL);
    expect(interiorWallType(all, { constructionId: PRESET_IDS.wallBrick }).id).toBe(
      DEFAULT_INTERIOR_WALL,
    );
  });

  it("insulate as their layers say: drywall with mineral wool best, a thin brick wall worst", () => {
    const u = (id: string) => interiorWallType(all, { constructionId: id }).uValue;
    expect(u(PRESET_IDS.interiorDrywall)).toBeCloseTo(0.4, 1);
    expect(u(PRESET_IDS.interiorPartition)).toBeCloseTo(2.49, 2);
    expect(u(PRESET_IDS.interiorBearing24)).toBeLessThan(u(PRESET_IDS.interiorPartition));
    expect(u(PRESET_IDS.interiorBearing365)).toBeLessThan(u(PRESET_IDS.interiorBearing24));
  });

  it("are added to a building saved before they existed, once", () => {
    const old = all.filter((c) => c.category !== "interiorWall");
    const added = withInteriorWallTypes(old, "de");
    expect(added.filter((c) => c.category === "interiorWall").map((c) => c.name)).toContain(
      "Trennwand, 11,5 cm",
    );
    expect(withInteriorWallTypes(added, "de")).toHaveLength(added.length);
  });

  it("snap a thickness read off a plan to the nearest type", () => {
    const near = (m: number) => nearestInteriorWallType(all, m).id;
    expect(near(0.09)).toBe(PRESET_IDS.interiorDrywall);
    expect(near(0.13)).toBe(PRESET_IDS.interiorPartition);
    expect(near(0.22)).toBe(PRESET_IDS.interiorBearing24);
    expect(near(0.4)).toBe(PRESET_IDS.interiorBearing365);
  });
});

describe("walls of different types", () => {
  const ctx = {
    footprint: [
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 10, y: 6 },
      { x: 0, y: 6 },
    ],
    exteriorThickness: 0.3,
    thicknessOf,
  };
  const bearing = PRESET_IDS.interiorBearing24;

  it("keep their type when split, and stay two walls where they meet straight", () => {
    const { walls } = normalizeWalls({
      walls: [
        { a: { x: 6, y: 0 }, b: { x: 6, y: 6 }, constructionId: bearing },
        { a: { x: 0, y: 2 }, b: { x: 6, y: 2 } },
        { a: { x: 6, y: 2 }, b: { x: 10, y: 2 }, constructionId: bearing },
      ],
      openings: [],
    });
    // The bearing wall in two pieces, and the partition and bearing wall on one line apart.
    expect(walls).toHaveLength(4);
    expect(walls.filter((w) => w.constructionId === bearing)).toHaveLength(3);
  });

  it("stop a joining wall at the face of the wall it meets, however thick that is", () => {
    const walls: InteriorWall[] = normalizeWalls({
      walls: [
        { a: { x: 6, y: 0 }, b: { x: 6, y: 6 }, constructionId: bearing },
        { a: { x: 0, y: 2 }, b: { x: 6, y: 2 } },
      ],
      openings: [],
    }).walls;
    const stem = walls.findIndex((w) => w.a.y === 2 && w.b.y === 2);
    expect(pieceRange(stem, walls, ctx)[1]).toBeCloseTo(6 - 0.12, 9);
  });

  it("give a room its clear size by the thickness of each wall around it", () => {
    const walls: InteriorWall[] = [
      { a: { x: 6, y: 0 }, b: { x: 6, y: 6 }, constructionId: bearing },
      { a: { x: 0, y: 2 }, b: { x: 6, y: 2 } },
    ];
    const room = [
      { x: 0, y: 0 },
      { x: 6, y: 0 },
      { x: 6, y: 2 },
      { x: 0, y: 2 },
    ];
    const clear = clearRoomPolygon(room, ctx.footprint, 0.3, walls, thicknessOf);
    const xs = clear.map((p) => p.x);
    const ys = clear.map((p) => p.y);
    expect(Math.max(...xs)).toBeCloseTo(6 - 0.12, 9);
    expect(Math.max(...ys)).toBeCloseTo(2 - 0.0575, 9);
  });
});
