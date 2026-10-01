import { describe, expect, it } from "vitest";
import { area, equals } from "./polygon";
import { lShape, rect } from "./fixtures";
import { buildWalls, interiorWallAsWall, wallSolids, wallThicknessAt } from "./walls";
import type { WallPrism } from "./walls";
import type { Opening } from "./types";

describe("buildWalls", () => {
  it("produces one wall per vertex with the storey height", () => {
    const walls = buildWalls(rect, 0.3, 3);
    expect(walls).toHaveLength(4);
    expect(walls.every((w) => w.height === 3)).toBe(true);
    expect(walls.map((w) => w.length)).toEqual([10, 8, 10, 8]);
  });

  it("offsets the inner face inward by the thickness on a rectangle", () => {
    const walls = buildWalls(rect, 0.3, 3);
    expect(walls[0]?.innerA.x).toBeCloseTo(0.3);
    expect(walls[0]?.innerA.y).toBeCloseTo(0.3);
    expect(walls[0]?.innerB.x).toBeCloseTo(9.7);
    expect(walls[0]?.innerB.y).toBeCloseTo(0.3);
    expect(walls[2]?.innerA.x).toBeCloseTo(9.7);
    expect(walls[2]?.innerA.y).toBeCloseTo(7.7);
    for (const w of walls) {
      expect(wallThicknessAt(w, 0)).toBeCloseTo(0.3);
      expect(wallThicknessAt(w, 0.5)).toBeCloseTo(0.3);
      expect(wallThicknessAt(w, 1)).toBeCloseTo(0.3);
    }
  });

  it("mitres the corners so neighbouring walls share the inner corner", () => {
    for (const footprint of [rect, lShape]) {
      const walls = buildWalls(footprint, 0.3, 3);
      const n = walls.length;
      for (let i = 0; i < n; i++) {
        const a = walls[i];
        const b = walls[(i + 1) % n];
        if (!a || !b) throw new Error("missing wall");
        expect(equals(a.innerB, b.innerA)).toBe(true);
        expect(equals(a.outerB, b.outerA)).toBe(true);
      }
    }
  });

  it("honours the thickness on the concave L shape, including the inner corner", () => {
    const walls = buildWalls(lShape, 0.3, 3);
    expect(walls).toHaveLength(6);
    for (const w of walls) {
      expect(wallThicknessAt(w, 0.5)).toBeCloseTo(0.3);
    }
    // The re-entrant corner at (6,5) moves to (5.7, 4.7): the wall material sits
    // inside the polygon, so the inner corner is pulled into the lower left block.
    expect(walls[3]?.innerA.x).toBeCloseTo(5.7);
    expect(walls[3]?.innerA.y).toBeCloseTo(4.7);
  });

  it("the wall quads cover exactly the ring between outer and inner polygon", () => {
    const thickness = 0.3;
    const walls = buildWalls(rect, thickness, 3);
    const quadArea = walls.reduce((sum, w) => sum + area(w.quad), 0);
    const ring = 80 - (10 - 0.6) * (8 - 0.6);
    expect(quadArea).toBeCloseTo(ring);
  });
});

describe("wallSolids", () => {
  const wall = () => buildWalls(rect, 0.3, 3)[0]!;
  const windowOpening: Opening = {
    id: "w",
    wallIndex: 0,
    kind: "window",
    offset: 2,
    width: 1.2,
    height: 1.4,
    sill: 0.9,
    constructionId: "c_glazing_double",
  };
  const doorOpening: Opening = {
    id: "d",
    wallIndex: 0,
    kind: "door",
    offset: 6,
    width: 1,
    height: 2.1,
    sill: 0,
    constructionId: "c_door_old",
  };
  const volume = (prisms: readonly WallPrism[]) =>
    prisms.reduce((sum, p) => sum + area(p.plan) * (p.top - p.bottom), 0);

  it("a wall without openings is a single full height prism", () => {
    const prisms = wallSolids(wall(), []);
    expect(prisms).toHaveLength(1);
    expect(prisms[0]?.bottom).toBe(0);
    expect(prisms[0]?.top).toBe(3);
    expect(prisms[0]?.plan).toEqual(wall().quad);
  });

  it("removes exactly the opening volume", () => {
    const w = wall();
    const full = volume(wallSolids(w, []));
    const cut = volume(wallSolids(w, [windowOpening, doorOpening]));
    const removed = (1.2 * 1.4 + 1 * 2.1) * 0.3;
    expect(full - cut).toBeCloseTo(removed, 6);
  });

  it("a window column has a part below and above, a door column only above", () => {
    const prisms = wallSolids(wall(), [windowOpening, doorOpening]);
    // left, below window, above window, between, above door, right
    expect(prisms).toHaveLength(6);
    const aboveDoor = prisms.find((p) => p.bottom === 2.1);
    expect(aboveDoor?.top).toBe(3);
    expect(prisms.some((p) => p.bottom === 0 && p.top === 0.9)).toBe(true);
  });

  it("ignores an invalid opening", () => {
    expect(wallSolids(wall(), [{ ...windowOpening, offset: 9.5 }])).toHaveLength(1);
  });

  it("an opening flush with the wall start still keeps the mitred corner", () => {
    const prisms = wallSolids(wall(), [{ ...doorOpening, offset: 0 }]);
    expect(prisms).toHaveLength(2);
    expect(prisms[0]?.plan[3]).toEqual(wall().innerA);
  });
});

describe("interiorWallAsWall", () => {
  it("centres the thickness on the segment and cuts openings like an exterior wall", () => {
    const wall = interiorWallAsWall({ a: { x: 0, y: 0 }, b: { x: 4, y: 0 } }, 2, 3, 0.1);
    expect(wall.index).toBe(2);
    expect(wall.length).toBe(4);
    expect(wall.height).toBe(3);
    expect(wall.direction).toEqual({ x: 1, y: 0 });
    expect(wall.outerA.y).toBeCloseTo(-0.05);
    expect(wall.innerA.y).toBeCloseTo(0.05);
    const door = {
      id: "d",
      wallIndex: 2,
      interior: true,
      kind: "door" as const,
      offset: 1,
      width: 1,
      height: 2.1,
      sill: 0,
      constructionId: "c",
    };
    const prisms = wallSolids(wall, [door]);
    const volume = prisms.reduce((v, p) => {
      const [a, b, c] = p.plan;
      const w = Math.hypot(b.x - a.x, b.y - a.y);
      const t = Math.hypot(c.x - b.x, c.y - b.y);
      return v + w * t * (p.top - p.bottom);
    }, 0);
    expect(volume).toBeCloseTo(4 * 3 * 0.1 - 1 * 2.1 * 0.1, 6);
  });
});

describe("building only part of a wall", () => {
  it("cuts the solid to the range and leaves the openings where they are", () => {
    const wall = interiorWallAsWall({ a: { x: 0, y: 0 }, b: { x: 6, y: 0 } }, 0, 3, 0.1);
    const door = {
      id: "d",
      wallIndex: 0,
      interior: true,
      kind: "door" as const,
      offset: 2,
      width: 0.9,
      height: 2.1,
      sill: 0,
      constructionId: "d",
    };
    const whole = wallSolids(wall, [door]);
    const cut = wallSolids(wall, [door], [0.3, 5.95]);
    const xs = (prisms: typeof whole) => prisms.flatMap((p) => p.plan.map((q) => q.x));
    expect(Math.min(...xs(whole))).toBeCloseTo(0, 9);
    expect(Math.min(...xs(cut))).toBeCloseTo(0.3, 9);
    expect(Math.max(...xs(cut))).toBeCloseTo(5.95, 9);
    // The door's hole is where it was: the lintel over it spans 2 to 2.9 in both.
    const lintel = (prisms: typeof whole) =>
      prisms.find((p) => p.bottom > 0)?.plan.map((q) => Number(q.x.toFixed(6)));
    expect(lintel(cut)).toEqual(lintel(whole));
  });

  it("builds nothing for an inverted range, as a short piece across a corner gets", () => {
    const wall = interiorWallAsWall({ a: { x: 0, y: 0.4 }, b: { x: 0.4, y: 0 } }, 0, 2.5, 0.115);
    expect(wallSolids(wall, [], [0.51, 0.06])).toEqual([]);
  });
});

describe("a wall with no solid left", () => {
  it("builds nothing when a door fills the whole wall", () => {
    const [wall] = buildWalls(
      [
        { x: 0, y: 0 },
        { x: 4, y: 0 },
        { x: 4, y: 3 },
        { x: 0, y: 3 },
      ],
      0.3,
      2.5,
    );
    const door: Opening = {
      id: "d",
      wallIndex: 0,
      kind: "door",
      offset: 0,
      width: 4,
      height: 2.5,
      sill: 0,
      constructionId: "d",
    };
    expect(wallSolids(wall!, [door])).toEqual([]);
  });
});
