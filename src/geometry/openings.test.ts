import { describe, expect, it } from "vitest";
import {
  clampOpening,
  joinTouchingOpenings,
  dragOpening,
  MIN_OPENING_SIZE,
  openingsOverlap,
  snapOffset,
  validateOpening,
  openingsOn,
  sameWall,
} from "./openings";
import type { Opening } from "./types";

const ctx = { wallLength: 10, storeyHeight: 3, siblings: [] as Opening[] };

const window = (patch: Partial<Opening> = {}): Opening => ({
  id: "w1",
  wallIndex: 0,
  kind: "window",
  offset: 1,
  width: 1.2,
  height: 1.4,
  sill: 0.9,
  constructionId: "c_glazing_double",
  ...patch,
});

const door = (patch: Partial<Opening> = {}): Opening => ({
  id: "d1",
  wallIndex: 0,
  kind: "door",
  offset: 4,
  width: 1,
  height: 2.1,
  sill: 0,
  constructionId: "c_door_old",
  ...patch,
});

describe("validateOpening", () => {
  it("accepts a normal window and a normal door", () => {
    expect(validateOpening(window(), ctx)).toEqual([]);
    expect(validateOpening(door(), ctx)).toEqual([]);
  });

  it("offset must be at least 0", () => {
    expect(validateOpening(window({ offset: -0.1 }), ctx)).toContain("outsideWallStart");
    expect(validateOpening(window({ offset: 0 }), ctx)).toEqual([]);
  });

  it("offset plus width must not exceed the wall length", () => {
    expect(validateOpening(window({ offset: 9, width: 1.2 }), ctx)).toContain("outsideWallEnd");
    expect(validateOpening(window({ offset: 8.8, width: 1.2 }), ctx)).toEqual([]);
  });

  it("sill plus height must not exceed the storey height", () => {
    expect(validateOpening(window({ sill: 2, height: 1.4 }), ctx)).toContain("tooTall");
    expect(validateOpening(window({ sill: 1.6, height: 1.4 }), ctx)).toEqual([]);
  });

  it("doors sit on the floor", () => {
    expect(validateOpening(door({ sill: 0.2 }), ctx)).toContain("doorNotOnFloor");
    expect(validateOpening(door({ sill: 0 }), ctx)).toEqual([]);
  });

  it("rejects negative sills and tiny openings", () => {
    expect(validateOpening(window({ sill: -0.1 }), ctx)).toContain("negativeSill");
    expect(validateOpening(window({ width: 0.05 }), ctx)).toContain("tooSmall");
  });

  it("rejects non-finite dimensions and wall contexts", () => {
    expect(validateOpening(window({ width: Number.NaN }), ctx)).toEqual(["nonFinite"]);
    expect(validateOpening(window({ offset: Number.POSITIVE_INFINITY }), ctx)).toEqual([
      "nonFinite",
    ]);
    expect(validateOpening(window(), { ...ctx, wallLength: Number.NaN })).toEqual(["nonFinite"]);
  });

  it("two openings that touch exactly are allowed", () => {
    const a = window({ id: "a", offset: 1, width: 1.2 });
    const b = window({ id: "b", offset: 2.2, width: 1.2 });
    expect(validateOpening(a, { ...ctx, siblings: [a, b] })).toEqual([]);
    expect(validateOpening(b, { ...ctx, siblings: [a, b] })).toEqual([]);
  });

  it("overlapping by 1 mm is rejected", () => {
    const a = window({ id: "a", offset: 1, width: 1.2 });
    const b = window({ id: "b", offset: 2.199, width: 1.2 });
    expect(validateOpening(a, { ...ctx, siblings: [a, b] })).toContain("overlaps");
    expect(validateOpening(b, { ...ctx, siblings: [a, b] })).toContain("overlaps");
    expect(openingsOverlap(a, b)).toBe(true);
  });

  it("openings on different walls never overlap each other", () => {
    const a = window({ id: "a", wallIndex: 0 });
    const b = window({ id: "b", wallIndex: 1 });
    expect(validateOpening(a, { ...ctx, siblings: [a, b] })).toEqual([]);
  });
});

describe("clampOpening and snapOffset", () => {
  it("pulls an opening back inside the wall and storey", () => {
    const c = clampOpening(window({ offset: 9.5, width: 1.2, sill: 2.5, height: 1.4 }), ctx);
    expect(c.offset).toBeCloseTo(8.8);
    expect(c.width).toBe(1.2);
    expect(c.sill + c.height).toBeLessThanOrEqual(3);
    expect(validateOpening(c, ctx)).toEqual([]);
  });

  it("forces a door to the floor", () => {
    expect(clampOpening(door({ sill: 0.5 }), ctx).sill).toBe(0);
  });

  it("snaps offsets to 0.1 m and keeps them inside", () => {
    expect(snapOffset(1.26, 1, 10)).toBe(1.3);
    expect(snapOffset(-2, 1, 10)).toBe(0);
    expect(snapOffset(20, 1, 10)).toBe(9);
  });
});

describe("interior openings", () => {
  const base = {
    id: "a",
    wallIndex: 0,
    kind: "door" as const,
    offset: 1,
    width: 1,
    height: 2.1,
    sill: 0,
    constructionId: "c",
  };
  it("only openings on the same wall kind overlap", () => {
    const interior = { ...base, id: "b", interior: true };
    expect(sameWall(base, interior)).toBe(false);
    expect(sameWall(interior, { ...interior, id: "c" })).toBe(true);
    const ctx = { wallLength: 5, storeyHeight: 3, siblings: [base, interior] };
    expect(validateOpening(base, ctx)).toEqual([]);
    expect(validateOpening({ ...interior, id: "c" }, ctx)).toContain("overlaps");
  });
  it("filters openings per wall", () => {
    const interior = { ...base, id: "b", interior: true };
    expect(openingsOn([base, interior], 0)).toEqual([base]);
    expect(openingsOn([base, interior], 0, true)).toEqual([interior]);
  });
});

describe("dragging an opening in the floor plan", () => {
  const base: Opening = {
    id: "a",
    wallIndex: 0,
    kind: "window",
    offset: 2,
    width: 1,
    height: 1.4,
    sill: 0.9,
    constructionId: "w",
  };
  const left: Opening = { ...base, id: "left", offset: 0.5, width: 1 };
  const right: Opening = { ...base, id: "right", offset: 5, width: 1 };
  const all = [left, base, right];

  it("moves along the wall on the centimetre and stops at its neighbours", () => {
    expect(dragOpening(base, all, 10, "move", 3.1234)).toEqual({ offset: 3.12, width: 1 });
    expect(dragOpening(base, all, 10, "move", 0)).toEqual({ offset: 1.5, width: 1 });
    expect(dragOpening(base, all, 10, "move", 9)).toEqual({ offset: 4, width: 1 });
  });

  it("resizes from either edge, keeping the other edge where it was", () => {
    expect(dragOpening(base, all, 10, "start", 1.8)).toEqual({ offset: 1.8, width: 1.2 });
    expect(dragOpening(base, all, 10, "end", 3.555)).toEqual({ offset: 2, width: 1.56 });
    // Not past the neighbours, and never narrower than the smallest opening.
    expect(dragOpening(base, all, 10, "start", 0)).toEqual({ offset: 1.5, width: 1.5 });
    expect(dragOpening(base, all, 10, "end", 8)).toEqual({ offset: 2, width: 3 });
    expect(dragOpening(base, all, 10, "end", 1)).toEqual({ offset: 2, width: MIN_OPENING_SIZE });
  });

  it("stays on the wall and leaves an overlapping opening alone", () => {
    expect(dragOpening(base, [base], 4, "end", 9)).toEqual({ offset: 2, width: 2 });
    const stuck = { ...left, offset: 2.5 };
    expect(dragOpening(base, [base, stuck], 10, "move", 6)).toEqual({ offset: 2, width: 1 });
  });
});

describe("joinTouchingOpenings", () => {
  const door = (id: string, offset: number, width: number, height: number) => ({
    id,
    wallIndex: 4,
    kind: "door" as const,
    offset,
    width,
    height,
    sill: 0,
    constructionId: "door",
  });

  it("makes an entrance stored as a door and a strip beside it one rectangle", () => {
    // BOo's east entrance as an older survey stored it: 0.89 m by 2.15 m, and 0.47 by 2.83 beside.
    const joined = joinTouchingOpenings([
      door("a", 12.01, 0.89, 2.15),
      door("b", 12.9, 0.47, 2.83),
    ]);
    expect(joined).toHaveLength(1);
    expect(joined[0]?.id).toBe("a");
    expect(joined[0]?.offset).toBeCloseTo(12.01);
    expect(joined[0]?.width).toBeCloseTo(1.36);
    expect(joined[0]?.height).toBeCloseTo(2.83);
  });

  it("leaves openings apart, on other walls or of another kind alone", () => {
    const window = { ...door("w", 13.0, 1.0, 1.5), kind: "window" as const, sill: 0.9 };
    const openings = [
      door("a", 1, 0.9, 2.1),
      door("b", 2.5, 0.9, 2.1),
      { ...door("c", 1.9, 0.9, 2.1), wallIndex: 2 },
      door("d", 12.01, 0.99, 2.15),
      window,
    ];
    expect(joinTouchingOpenings(openings)).toEqual(openings);
  });
});
