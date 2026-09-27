import { describe, expect, it } from "vitest";
import { rect } from "./fixtures";
import { dimension, openingChain, openingSymbol, wallPoche } from "./plan";
import { area } from "./polygon";
import type { Opening } from "./types";
import { buildWalls } from "./walls";

const walls = buildWalls(rect, 0.3, 3);
const south = walls[0];
if (!south) throw new Error("fixture has no first wall");

const opening = (patch: Partial<Opening>): Opening => ({
  id: "o",
  wallIndex: 0,
  kind: "window",
  offset: 2,
  width: 1.2,
  height: 1.4,
  sill: 0.9,
  constructionId: "window",
  ...patch,
});

describe("wallPoche", () => {
  it("is the whole wall quad without openings", () => {
    const solids = wallPoche(south, []);
    expect(solids).toHaveLength(1);
    expect(area(solids[0] ?? [])).toBeCloseTo(area(south.quad), 6);
  });

  it("leaves a gap the width of each opening", () => {
    const solids = wallPoche(south, [
      opening({ offset: 2, width: 1.2 }),
      opening({ id: "b", offset: 6, width: 1 }),
    ]);
    expect(solids).toHaveLength(3);
    const total = solids.reduce((sum, s) => sum + area(s), 0);
    expect(total).toBeCloseTo(area(south.quad) - (1.2 + 1) * 0.3, 6);
  });

  it("ignores an invalid opening instead of cutting the wall", () => {
    const solids = wallPoche(south, [opening({ offset: 9.5, width: 2 })]);
    expect(solids).toHaveLength(1);
  });
});

describe("openingSymbol", () => {
  it("draws a window as two jambs and three lines across the gap", () => {
    const symbol = openingSymbol(south, opening({}));
    expect(symbol.jambs).toHaveLength(2);
    expect(symbol.lines).toHaveLength(3);
    expect(symbol.leaf).toBeNull();
    // The jambs run through the wall thickness.
    const [a, b] = symbol.jambs[0] ?? [];
    expect(Math.hypot((b?.x ?? 0) - (a?.x ?? 0), (b?.y ?? 0) - (a?.y ?? 0))).toBeCloseTo(0.3, 6);
  });

  it("opens a door into the building with a leaf as long as the door is wide", () => {
    const symbol = openingSymbol(south, opening({ kind: "door", sill: 0, height: 2.1, width: 1 }));
    const [hinge, tip] = symbol.leaf ?? [];
    expect(
      Math.hypot((tip?.x ?? 0) - (hinge?.x ?? 0), (tip?.y ?? 0) - (hinge?.y ?? 0)),
    ).toBeCloseTo(1, 6);
    // The rectangle's first wall is at y = 0 with the building above it: the leaf points up.
    expect(tip?.y ?? 0).toBeGreaterThan(hinge?.y ?? 0);
    // The arc keeps the leaf length and ends back at the far side of the gap.
    for (const p of symbol.arc) {
      expect(Math.hypot(p.x - (hinge?.x ?? 0), p.y - (hinge?.y ?? 0))).toBeCloseTo(1, 6);
    }
    const end = symbol.arc[symbol.arc.length - 1];
    expect(end?.y ?? 0).toBeCloseTo(hinge?.y ?? 0, 6);
  });
});

describe("dimension", () => {
  it("draws the line offset along the normal, with ticks and a centred label", () => {
    const d = dimension({ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 0, y: -1 }, 1);
    expect(d.length).toBeCloseTo(10, 9);
    expect(d.line[0]).toEqual({ x: 0, y: -1 });
    expect(d.line[1]).toEqual({ x: 10, y: -1 });
    expect(d.label).toEqual({ x: 5, y: -1 });
    expect(d.extensions).toHaveLength(2);
    expect(d.ticks).toHaveLength(2);
    // The extension line starts off the wall and runs past the dimension line.
    expect(d.extensions[0]?.[0].y).toBeCloseTo(-0.15, 9);
    expect(d.extensions[0]?.[1].y).toBeCloseTo(-1.2, 9);
  });
});

describe("openingChain", () => {
  it("measures the wall pieces and the openings, and adds up to the wall", () => {
    const chain = openingChain(south, [opening({ offset: 2, width: 1.2 })], 0.6);
    expect(chain.map((d) => Number(d.length.toFixed(6)))).toEqual([2, 1.2, 6.8]);
  });

  it("is empty for a wall without openings", () => {
    expect(openingChain(south, [], 0.6)).toEqual([]);
  });
});
