import { describe, expect, it } from "vitest";
import type { Opening, Segment } from "./types";
import { moveWall, normalizeWalls, pieceRange } from "./wallGraph";

const door = (wallIndex: number, offset: number, width = 0.9): Opening => ({
  id: `d${String(wallIndex)}-${String(offset)}`,
  wallIndex,
  interior: true,
  kind: "door",
  offset,
  width,
  height: 2.1,
  sill: 0,
  constructionId: "d",
});

// A 10 x 6 building, walls 0.3 thick.
const ctx = {
  footprint: [
    { x: 0, y: 0 },
    { x: 10, y: 0 },
    { x: 10, y: 6 },
    { x: 0, y: 6 },
  ],
  exteriorThickness: 0.3,
  thicknessOf: () => 0.1,
};

const round = (walls: Segment[]) =>
  walls
    .map((w) => [w.a, w.b].map((p) => [Number(p.x.toFixed(6)), Number(p.y.toFixed(6))]))
    .map((pair) => pair.sort((p, q) => (p[0] ?? 0) - (q[0] ?? 0) || (p[1] ?? 0) - (q[1] ?? 0)))
    .sort((p, q) => JSON.stringify(p).localeCompare(JSON.stringify(q)));

describe("walls from joint to joint", () => {
  it("splits a wall where another joins it, and its door goes with its piece", () => {
    const set = normalizeWalls({
      walls: [
        { a: { x: 6, y: 0 }, b: { x: 6, y: 6 } },
        { a: { x: 0, y: 2 }, b: { x: 6, y: 2 } },
      ],
      openings: [door(0, 3)],
    });
    expect(round(set.walls)).toEqual(
      round([
        { a: { x: 6, y: 0 }, b: { x: 6, y: 2 } },
        { a: { x: 6, y: 2 }, b: { x: 6, y: 6 } },
        { a: { x: 0, y: 2 }, b: { x: 6, y: 2 } },
      ]),
    );
    const d = set.openings[0];
    const host = set.walls[d?.wallIndex ?? -1];
    expect(host?.a).toEqual({ x: 6, y: 2 });
    expect(d?.offset).toBeCloseTo(1, 9);
  });

  it("slides a door that reached past a joint back onto its piece", () => {
    const set = normalizeWalls({
      walls: [
        { a: { x: 6, y: 0 }, b: { x: 6, y: 6 } },
        { a: { x: 0, y: 2 }, b: { x: 6, y: 2 } },
      ],
      // From y = 1.5 to y = 2.4: across the joint at y = 2, mostly below it.
      openings: [door(0, 1.5, 0.9)],
    });
    const d = set.openings[0];
    const host = set.walls[d?.wallIndex ?? -1];
    if (!d || !host) throw new Error("no door");
    const length = Math.hypot(host.b.x - host.a.x, host.b.y - host.a.y);
    expect(d.offset + d.width).toBeLessThanOrEqual(length + 1e-9);
    expect(d.width).toBeCloseTo(0.9, 9);
  });

  it("splits two crossing walls into four, and changes nothing the second time", () => {
    const once = normalizeWalls({
      walls: [
        { a: { x: 5, y: 0 }, b: { x: 5, y: 6 } },
        { a: { x: 0, y: 3 }, b: { x: 10, y: 3 } },
      ],
      openings: [],
    });
    expect(once.walls).toHaveLength(4);
    expect(normalizeWalls(once)).toEqual(once);
  });

  it("joins two straight pieces back into one when nothing joins between them", () => {
    const set = normalizeWalls({
      walls: [
        { a: { x: 6, y: 0 }, b: { x: 6, y: 2 } },
        { a: { x: 6, y: 2 }, b: { x: 6, y: 6 } },
      ],
      openings: [door(1, 1)],
    });
    expect(round(set.walls)).toEqual(round([{ a: { x: 6, y: 0 }, b: { x: 6, y: 6 } }]));
    expect(set.openings[0]?.wallIndex).toBe(0);
    expect(set.openings[0]?.offset).toBeCloseTo(3, 9);
  });
});

describe("moving a wall", () => {
  // The wall at x = 6 split by a wall from the left at y = 2.
  const start = normalizeWalls({
    walls: [
      { a: { x: 6, y: 0 }, b: { x: 6, y: 6 } },
      { a: { x: 0, y: 2 }, b: { x: 6, y: 2 } },
    ],
    openings: [],
  });
  const upper = start.walls.findIndex((w) => Math.min(w.a.y, w.b.y) === 2 && w.a.x === 6);

  it("slides sideways; the wall it meets grows to stay joined", () => {
    const w = start.walls[upper];
    if (!w) throw new Error("no wall");
    // Its left normal points to -x when it runs up, +x when it runs down.
    const towardsRight = w.b.y > w.a.y ? -1 : 1;
    const moved = moveWall(upper, towardsRight, start, ctx);
    if (!moved) throw new Error("refused");
    expect(round(moved.walls)).toEqual(
      round([
        { a: { x: 6, y: 0 }, b: { x: 6, y: 2 } },
        { a: { x: 7, y: 2 }, b: { x: 7, y: 6 } },
        { a: { x: 0, y: 2 }, b: { x: 6, y: 2 } },
        { a: { x: 6, y: 2 }, b: { x: 7, y: 2 } },
      ]),
    );
    const at = moved.walls[moved.index];
    expect(Math.min(at?.a.x ?? 0, at?.b.x ?? 0)).toBeCloseTo(7, 9);
  });

  it("slides the other way along the wall it meets", () => {
    const w = start.walls[upper];
    if (!w) throw new Error("no wall");
    const towardsLeft = w.b.y > w.a.y ? 1 : -1;
    const moved = moveWall(upper, towardsLeft, start, ctx);
    if (!moved) throw new Error("refused");
    expect(round(moved.walls)).toEqual(
      round([
        { a: { x: 6, y: 0 }, b: { x: 6, y: 2 } },
        { a: { x: 5, y: 2 }, b: { x: 5, y: 6 } },
        { a: { x: 0, y: 2 }, b: { x: 5, y: 2 } },
        { a: { x: 5, y: 2 }, b: { x: 6, y: 2 } },
      ]),
    );
  });

  it("moves an L corner together: the other wall shortens with it", () => {
    const corner = normalizeWalls({
      walls: [
        { a: { x: 6, y: 0 }, b: { x: 6, y: 2 } },
        { a: { x: 0, y: 2 }, b: { x: 6, y: 2 } },
      ],
      openings: [],
    });
    const i = corner.walls.findIndex((w) => w.a.x === 6 && w.b.x === 6);
    const w = corner.walls[i];
    if (!w) throw new Error("no wall");
    const left = w.b.y > w.a.y ? 1 : -1;
    const moved = moveWall(i, left * 2, corner, ctx);
    expect(moved && round(moved.walls)).toEqual(
      round([
        { a: { x: 4, y: 0 }, b: { x: 4, y: 2 } },
        { a: { x: 0, y: 2 }, b: { x: 4, y: 2 } },
      ]),
    );
  });

  it("refuses to pass over another wall, onto a door, or out of the building", () => {
    const w = start.walls[upper];
    if (!w) throw new Error("no wall");
    const right = w.b.y > w.a.y ? -1 : 1;
    const blocked = normalizeWalls({
      walls: [...start.walls, { a: { x: 8, y: 0 }, b: { x: 8, y: 6 } }],
      openings: [],
    });
    const again = blocked.walls.findIndex((x) => x.a.x === 6 && Math.min(x.a.y, x.b.y) === 2);
    expect(moveWall(again, right * 3, blocked, ctx)).toBeNull();

    const hInStart = start.walls.findIndex((x) => x.a.y === 2 && x.b.y === 2);
    const withDoor = { ...start, openings: [door(hInStart, 4.6)] };
    expect(moveWall(upper, -right, withDoor, ctx)).toBeNull();

    const lower = start.walls.findIndex((x) => x.a.x === 6 && Math.max(x.a.y, x.b.y) === 2);
    const lw = start.walls[lower];
    if (!lw) throw new Error("no wall");
    const leftOfLower = lw.b.y > lw.a.y ? 1 : -1;
    expect(moveWall(lower, leftOfLower * 5.9, start, ctx)).toBeNull();
  });
});

describe("where a wall piece is seen", () => {
  const find = (walls: Segment[], a: [number, number], b: [number, number]) =>
    walls.findIndex(
      (w) =>
        (w.a.x === a[0] && w.a.y === a[1] && w.b.x === b[0] && w.b.y === b[1]) ||
        (w.b.x === a[0] && w.b.y === a[1] && w.a.x === b[0] && w.a.y === b[1]),
    );
  const tee = normalizeWalls({
    walls: [
      { a: { x: 6, y: 0 }, b: { x: 6, y: 6 } },
      { a: { x: 0, y: 2 }, b: { x: 6, y: 2 } },
    ],
    openings: [],
  }).walls;

  it("runs a straight wall through the joint and stops the joining wall at its face", () => {
    const lower = find(tee, [6, 0], [6, 2]);
    const stem = find(tee, [0, 2], [6, 2]);
    const [from, to] = pieceRange(lower, tee, ctx);
    // From the exterior wall's inner face right up to the joint.
    expect(Math.min(from, 2 - to)).toBeCloseTo(0, 9);
    expect(Math.max(from, 2 - to)).toBeCloseTo(0.3, 9);
    const s = pieceRange(stem, tee, ctx);
    expect(s[0]).toBeCloseTo(0.3, 9);
    expect(s[1]).toBeCloseTo(6 - 0.05, 9);
  });

  it("fills a corner: both walls reach half a wall past it", () => {
    const corner = normalizeWalls({
      walls: [
        { a: { x: 6, y: 0 }, b: { x: 6, y: 2 } },
        { a: { x: 0, y: 2 }, b: { x: 6, y: 2 } },
      ],
      openings: [],
    }).walls;
    const h = find(corner, [0, 2], [6, 2]);
    const [, to] = pieceRange(h, corner, ctx);
    expect(to).toBeCloseTo(6 + 0.05, 9);
  });

  it("measures a chain to the face of a wall on its side and straight on past one on the far side", () => {
    const lower = find(tee, [6, 0], [6, 2]);
    const w = tee[lower];
    if (!w) throw new Error("no wall");
    const joint = w.a.y === 2 ? "a" : "b";
    // The joining wall comes from the left (-x).
    const left = { x: -1, y: 0 };
    const towardsLeft = pieceRange(lower, tee, ctx, left);
    const towardsRight = pieceRange(lower, tee, ctx, { x: 1, y: 0 });
    const at = (r: [number, number]) => (joint === "a" ? r[0] : 2 - r[1]);
    expect(at(towardsLeft)).toBeCloseTo(0.05, 9);
    expect(at(towardsRight)).toBeCloseTo(0, 9);
  });
});
