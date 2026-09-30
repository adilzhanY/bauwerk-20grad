import { describe, expect, it } from "vitest";
import { PRESET_IDS, defaultConstructions } from "./constructions";
import { floorPlanEdits } from "./floorPlanImport";

const FOOTPRINT = [
  { x: 0, y: 0 },
  { x: 12, y: 0 },
  { x: 12, y: 6 },
  { x: 0, y: 6 },
];

const walls = [
  { a: { x: 4.003, y: 0 }, b: { x: 4.001, y: 6 } },
  { a: { x: 4, y: 3 }, b: { x: 12, y: 3 } },
  // Drawing noise: too short to be a wall.
  { a: { x: 1, y: 1 }, b: { x: 1.2, y: 1 } },
];

describe("floorPlanEdits", () => {
  it("keeps walls to the centimetre and drops what is too short to be one", () => {
    const edits = floorPlanEdits(walls, [], FOOTPRINT, 3, []);
    expect(edits.interiorWalls).toEqual([
      { a: { x: 4, y: 0 }, b: { x: 4, y: 6 } },
      { a: { x: 4, y: 3 }, b: { x: 12, y: 3 } },
    ]);
  });

  it("welds a wall end that stops just short of another wall or the outline onto it", () => {
    const edits = floorPlanEdits(
      [
        { a: { x: 4, y: 0.03 }, b: { x: 4, y: 5.96 } },
        { a: { x: 4.02, y: 3 }, b: { x: 11.97, y: 3.01 } },
      ],
      [],
      FOOTPRINT,
      3,
      [],
    );
    const [v, h] = edits.interiorWalls;
    expect(v?.a).toEqual({ x: 4, y: 0 });
    expect(v?.b).toEqual({ x: 4, y: 6 });
    expect(h?.a.x).toBe(4);
    expect(h?.b.x).toBe(12);
  });

  it("puts each door on the wall it lies on, at its offset and width", () => {
    const edits = floorPlanEdits(
      walls,
      [
        { a: { x: 4.02, y: 2.4 }, b: { x: 4.02, y: 1.5 } },
        { a: { x: 7, y: 3.05 }, b: { x: 8.1, y: 3.05 } },
      ],
      FOOTPRINT,
      3,
      [],
    );
    expect(edits.doors).toEqual([
      { wallIndex: 0, offset: 1.5, width: 0.9 },
      { wallIndex: 1, offset: 3, width: 1.1 },
    ]);
    expect(edits.skippedDoors).toBe(0);
  });

  it("leaves out a door that fits no wall, and one that overlaps a door already placed", () => {
    const edits = floorPlanEdits(
      walls,
      [
        { a: { x: 4, y: 1.5 }, b: { x: 4, y: 2.4 } },
        { a: { x: 4, y: 2.0 }, b: { x: 4, y: 2.9 } },
        { a: { x: 9, y: 5 }, b: { x: 10, y: 5 } },
      ],
      FOOTPRINT,
      3,
      [],
    );
    expect(edits.doors).toHaveLength(1);
    expect(edits.skippedDoors).toBe(2);
  });

  it("gives a measured wall the type nearest its drawn thickness, and an unmeasured one none", () => {
    const edits = floorPlanEdits(
      [
        { a: { x: 4, y: 0 }, b: { x: 4, y: 6 }, thickness: 0.26 },
        { a: { x: 4, y: 3 }, b: { x: 12, y: 3 }, thickness: 0.12 },
        { a: { x: 8, y: 3 }, b: { x: 8, y: 6 } },
      ],
      [],
      FOOTPRINT,
      3,
      defaultConstructions("en"),
    );
    expect(edits.interiorWalls.map((w) => w.constructionId)).toEqual([
      PRESET_IDS.interiorBearing24,
      PRESET_IDS.interiorPartition,
      undefined,
    ]);
  });
});
