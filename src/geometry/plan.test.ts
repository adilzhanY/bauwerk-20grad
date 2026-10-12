import { describe, expect, it } from "vitest";
import { rect } from "./fixtures";
import {
  clearRoomPolygon,
  clearWallRange,
  dimension,
  openingChain,
  openingSpans,
  openingSymbol,
  roomMeasures,
  span,
  spanThrough,
  wallPoche,
  wallJunctions,
} from "./plan";
import { area } from "./polygon";
import type { Opening } from "./types";
import { buildWalls, interiorWallAsWall } from "./walls";

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

describe("openingSpans", () => {
  it("of two overlapping openings keeps the one placed first, as the energy balance does", () => {
    const wall = buildWalls(rect, 0.3, 3)[0]!;
    const first: Opening = {
      id: "a",
      wallIndex: 0,
      kind: "window",
      offset: 2,
      width: 1.2,
      height: 1.4,
      sill: 0.9,
      constructionId: "c_glazing_double",
    };
    expect(openingSpans(wall, [first, { ...first, id: "b", offset: 2.5 }])).toEqual([[2, 3.2]]);
  });
});

describe("openingSymbol", () => {
  it("draws a window as two jambs, the sills and the frame as a double line", () => {
    const symbol = openingSymbol(south, opening({}));
    expect(symbol.jambs).toHaveLength(2);
    expect(symbol.lines).toHaveLength(4);
    // The frame lines sit either side of the wall's middle, 7 cm apart.
    const frameY = symbol.lines.slice(1, 3).map((l) => Math.abs(l[0].y));
    expect(frameY[1]! - frameY[0]!).toBeCloseTo(0.07, 6);
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
  it("draws the line offset along the normal, with arrows and a centred label", () => {
    const d = dimension({ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 0, y: -1 }, 1);
    expect(d.length).toBeCloseTo(10, 9);
    expect(d.line[0]).toEqual({ x: 0, y: -1 });
    expect(d.line[1]).toEqual({ x: 10, y: -1 });
    expect(d.label).toEqual({ x: 5, y: -1 });
    expect(d.extensions).toHaveLength(2);
    // Each arrow has its tip on the line's end and points out toward its extension line.
    const [first, second] = d.arrows;
    expect(first?.[0]).toEqual({ x: 0, y: -1 });
    expect(first?.[1].x).toBeGreaterThan(0);
    expect(second?.[0]).toEqual({ x: 10, y: -1 });
    expect(second?.[1].x).toBeLessThan(10);
    // The extension line starts off the wall and runs past the dimension line.
    expect(d.extensions[0]?.[0].y).toBeCloseTo(-0.15, 9);
    expect(d.extensions[0]?.[1].y).toBeCloseTo(-1.2, 9);
  });
});

describe("openingChain", () => {
  it("measures the wall pieces and the openings, and adds up to the wall", () => {
    const chain = openingChain(south, [opening({ offset: 2, width: 1.2 })], 0.6);
    expect(chain.map((d) => Number(d.length.toFixed(6)))).toEqual([2, 1.2, 6.8]);
    // Only the opening piece carries its opening, for the width over height label.
    expect(chain.map((d) => d.opening?.id)).toEqual([undefined, "o", undefined]);
  });

  it("is empty for a wall without openings", () => {
    expect(openingChain(south, [], 0.6)).toEqual([]);
  });
});

describe("short dimensions and spans", () => {
  it("puts the arrows outside a distance too short for them, pointing in", () => {
    const d = dimension({ x: 0, y: 0 }, { x: 0.3, y: 0 }, { x: 0, y: -1 }, 1);
    expect(d.arrows[0]?.[1].x).toBeLessThan(0);
    expect(d.arrows[1]?.[1].x).toBeGreaterThan(0.3);
    expect(d.line[0].x).toBeLessThan(0);
    expect(d.line[1].x).toBeGreaterThan(0.3);
  });

  it("measures a clear span wall to wall, without extension lines", () => {
    const s = span({ x: 1, y: 2 }, { x: 5, y: 2 });
    expect(s.length).toBeCloseTo(4, 9);
    expect(s.line).toEqual([
      { x: 1, y: 2 },
      { x: 5, y: 2 },
    ]);
    expect(s.extensions).toEqual([]);
  });
});

describe("rooms", () => {
  const l = [
    { x: 0, y: 0 },
    { x: 6, y: 0 },
    { x: 6, y: 2 },
    { x: 2, y: 2 },
    { x: 2, y: 5 },
    { x: 0, y: 5 },
  ];

  it("finds where a line through a point leaves the room on both sides", () => {
    expect(spanThrough(l, { x: 1, y: 1 }, { x: 1, y: 0 })).toEqual([
      { x: 0, y: 1 },
      { x: 6, y: 1 },
    ]);
    expect(spanThrough(l, { x: 1, y: 4 }, { x: 1, y: 0 })).toEqual([
      { x: 0, y: 4 },
      { x: 2, y: 4 },
    ]);
  });

  it("measures a turned room along its own walls", () => {
    const turn = (p: { x: number; y: number }) => ({
      x: p.x * Math.cos(0.3) - p.y * Math.sin(0.3),
      y: p.x * Math.sin(0.3) + p.y * Math.cos(0.3),
    });
    const room = [
      { x: 0, y: 0 },
      { x: 4.2, y: 0 },
      { x: 4.2, y: 3.85 },
      { x: 0, y: 3.85 },
    ].map(turn);
    const m = roomMeasures(room);
    expect(m.width).toBeCloseTo(4.2, 9);
    expect(m.depth).toBeCloseTo(3.85, 9);
    expect(m.u.x).toBeGreaterThan(0);
  });

  it("stamps an L shaped room on its floor, not in the notch", () => {
    const m = roomMeasures(l);
    const inside = (p: { x: number; y: number }) =>
      (p.x > 0 && p.x < 6 && p.y > 0 && p.y < 2) || (p.x > 0 && p.x < 2 && p.y > 0 && p.y < 5);
    expect(inside(m.stamp)).toBe(true);
    expect(m.width).toBeCloseTo(6, 9);
    expect(m.depth).toBeCloseTo(5, 9);
  });
});

describe("clear room floor", () => {
  // A 10 x 6 building with a 0.3 m exterior wall; the room is its left part up to an
  // interior wall at x = 4, stored on the outer face and the wall's centre line.
  const footprint = [
    { x: 0, y: 0 },
    { x: 10, y: 0 },
    { x: 10, y: 6 },
    { x: 0, y: 6 },
  ];
  const room = [
    { x: 0, y: 0 },
    { x: 4, y: 0 },
    { x: 4, y: 6 },
    { x: 0, y: 6 },
  ];

  it("moves outline edges in by the exterior wall and wall edges by half an interior wall", () => {
    const clear = clearRoomPolygon(room, footprint, 0.3, [], () => 0.1);
    const xs = clear.map((p) => Number(p.x.toFixed(9)));
    const ys = clear.map((p) => Number(p.y.toFixed(9)));
    expect(Math.min(...xs)).toBeCloseTo(0.3, 9);
    expect(Math.max(...xs)).toBeCloseTo(3.95, 9);
    expect(Math.min(...ys)).toBeCloseTo(0.3, 9);
    expect(Math.max(...ys)).toBeCloseTo(5.7, 9);
  });

  it("gives spans that end on the inner faces of the walls", () => {
    const clear = clearRoomPolygon(room, footprint, 0.3, [], () => 0.1);
    const across = spanThrough(clear, { x: 2, y: 3 }, { x: 1, y: 0 });
    expect(across?.[0].x).toBeCloseTo(0.3, 9);
    expect(across?.[1].x).toBeCloseTo(3.95, 9);
    expect(roomMeasures(clear).width).toBeCloseTo(3.65, 9);
  });

  it("keeps an L shaped room's notch", () => {
    const l = [
      { x: 0, y: 0 },
      { x: 6, y: 0 },
      { x: 6, y: 2 },
      { x: 2, y: 2 },
      { x: 2, y: 5 },
      { x: 0, y: 5 },
    ];
    const outline = [
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 10, y: 10 },
      { x: 0, y: 10 },
    ];
    const clear = clearRoomPolygon(l, outline, 0.3, [], () => 0.1);
    // The inner corner of the L moves diagonally into the notch by half a wall each way.
    expect(clear[3]?.x).toBeCloseTo(2 - 0.05, 9);
    expect(clear[3]?.y).toBeCloseTo(2 - 0.05, 9);
  });
});

describe("clear wall range", () => {
  const footprint = [
    { x: 0, y: 0 },
    { x: 10, y: 0 },
    { x: 10, y: 6 },
    { x: 0, y: 6 },
  ];
  it("stops at the inner face of the exterior wall and at the face of another wall", () => {
    // From the outline at x = 0 to the centre line of a wall at x = 6.
    const wall = { a: { x: 0, y: 3 }, b: { x: 6, y: 3 } };
    const other = { a: { x: 6, y: 0 }, b: { x: 6, y: 6 } };
    const [from, to] = clearWallRange(wall, footprint, [other], 0.3, () => 0.1);
    expect(from).toBeCloseTo(0.3, 9);
    expect(to).toBeCloseTo(5.95, 9);
  });
  it("measures a chain of a wall with a door on its clear part only", () => {
    const walls = buildWalls(rect, 0.3, 3);
    const w = walls[0];
    if (!w) throw new Error("no wall");
    const chain = openingChain(w, [opening({ offset: 2, width: 1.2 })], 0.6, undefined, [
      0.3,
      w.length - 0.3,
    ]);
    expect(chain.map((d) => Number(d.length.toFixed(6)))).toEqual([1.7, 1.2, w.length - 3.5]);
  });
});

describe("walls meeting a wall", () => {
  // A wall along y = 3 from x = 0 to x = 10; its chain runs on the side of +y.
  const wall = { a: { x: 0, y: 3 }, b: { x: 10, y: 3 } };
  const up = { x: 0, y: 1 };

  it("breaks the chain for a wall joining from the chain's side, not from the far side", () => {
    const fromAbove = { a: { x: 4, y: 3 }, b: { x: 4, y: 6 } };
    const fromBelow = { a: { x: 7, y: 0 }, b: { x: 7, y: 3 } };
    const found = wallJunctions(wall, up, [fromAbove, fromBelow], () => 0.1);
    expect(found).toHaveLength(1);
    expect(found[0]?.[0]).toBeCloseTo(3.95, 9);
    expect(found[0]?.[1]).toBeCloseTo(4.05, 9);
    // Seen from the other side it is the other way round.
    expect(
      wallJunctions(wall, { x: 0, y: -1 }, [fromAbove, fromBelow], () => 0.1)[0]?.[0],
    ).toBeCloseTo(6.95, 9);
  });

  it("breaks it for a wall crossing straight through, on both sides", () => {
    const crossing = { a: { x: 5, y: 0 }, b: { x: 5, y: 6 } };
    expect(wallJunctions(wall, up, [crossing], () => 0.1)).toHaveLength(1);
    expect(wallJunctions(wall, { x: 0, y: -1 }, [crossing], () => 0.1)).toHaveLength(1);
  });

  it("leaves out walls at its own ends, walls it does not reach, and parallel walls", () => {
    const atEnd = { a: { x: 10, y: 0 }, b: { x: 10, y: 6 } };
    const beyond = { a: { x: 12, y: 3 }, b: { x: 12, y: 6 } };
    const parallel = { a: { x: 0, y: 4 }, b: { x: 10, y: 4 } };
    expect(wallJunctions(wall, up, [atEnd, beyond, parallel], () => 0.1)).toEqual([]);
  });

  it("measures a wall meeting at an angle along this wall", () => {
    const slanted = { a: { x: 4, y: 3 }, b: { x: 7, y: 6 } };
    const [piece] = wallJunctions(wall, up, [slanted], () => 0.1);
    // 0.1 across the slanted wall is 0.1 / sin(45 degrees) along this one.
    expect((piece?.[1] ?? 0) - (piece?.[0] ?? 0)).toBeCloseTo(0.1 / Math.SQRT1_2, 9);
  });

  it("gives clear width, the joining wall's thickness and clear width, adding up to the wall", () => {
    const w = interiorWallAsWall(wall, 0, 3, 0.1);
    const breaks = wallJunctions(
      wall,
      w.normal,
      [{ a: { x: 4, y: 3 }, b: { x: 4, y: 0 } }],
      () => 0.1,
    );
    const chain = openingChain(
      w,
      [opening({ offset: 1, width: 0.9 })],
      0.3,
      undefined,
      [0.3, 9.7],
      breaks,
    );
    const lengths = chain.map((d) => Number(d.length.toFixed(6)));
    expect(lengths).toEqual([0.7, 0.9, 2.05, 0.1, 5.65]);
    expect(lengths.reduce((a, b) => a + b, 0)).toBeCloseTo(9.4, 9);
    expect(chain[1]?.opening?.id).toBe("o");
    expect(chain[3]?.opening).toBeUndefined();
  });

  it("never cuts a door: a wall meeting inside an opening is left out", () => {
    const w = interiorWallAsWall(wall, 0, 3, 0.1);
    const chain = openingChain(
      w,
      [opening({ offset: 3.5, width: 0.9 })],
      0.3,
      undefined,
      [0, 10],
      [[3.95, 4.05]],
    );
    expect(chain.map((d) => Number(d.length.toFixed(6)))).toEqual([3.5, 0.9, 5.6]);
  });

  it("gives a wall without doors a chain when another wall meets it", () => {
    const w = interiorWallAsWall(wall, 0, 3, 0.1);
    const chain = openingChain(w, [], 0.3, undefined, [0, 10], [[3.95, 4.05]]);
    expect(chain.map((d) => Number(d.length.toFixed(6)))).toEqual([3.95, 0.1, 5.95]);
    expect(openingChain(w, [], 0.3)).toEqual([]);
  });
});
