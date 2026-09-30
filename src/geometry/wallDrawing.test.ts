import { describe, expect, it } from "vitest";
import { drawWallTo, MIN_CLEAR_LENGTH, snapToWall } from "./wallDrawing";
import type { WallContext } from "./wallDrawing";

// A 10 x 6 building, exterior walls 0.3 thick, one interior wall at x = 6 across it.
const ctx: WallContext = {
  footprint: [
    { x: 0, y: 0 },
    { x: 10, y: 0 },
    { x: 10, y: 6 },
    { x: 0, y: 6 },
  ],
  walls: [{ a: { x: 6, y: 0 }, b: { x: 6, y: 6 } }],
  exteriorThickness: 0.3,
  thicknessOf: () => 0.1,
};

describe("snapping to a wall", () => {
  it("puts the dot on the inner face of an exterior wall and stores the point on the outline", () => {
    const snap = snapToWall({ x: 2.345, y: 0.35 }, ctx, 0.2);
    expect(snap?.target).toEqual({ kind: "outline", index: 0 });
    expect(snap?.point.x).toBeCloseTo(2.35, 9);
    expect(snap?.point.y).toBeCloseTo(0, 9);
    expect(snap?.shown.y).toBeCloseTo(0.3, 9);
  });

  it("puts it on the face of an interior wall on the pointer's side, stored on its centre line", () => {
    const right = snapToWall({ x: 6.12, y: 3 }, ctx, 0.2);
    expect(right?.target).toEqual({ kind: "wall", index: 0 });
    expect(right?.point.x).toBeCloseTo(6, 9);
    const left = snapToWall({ x: 5.9, y: 3 }, ctx, 0.2);
    expect(Math.sign((left?.shown.x ?? 6) - 6)).toBe(-Math.sign((right?.shown.x ?? 6) - 6));
  });

  it("slides along the wall to the centimetre, not to a grid", () => {
    expect(snapToWall({ x: 3.4567, y: 0.3 }, ctx, 0.2)?.point.x).toBeCloseTo(3.46, 9);
    expect(snapToWall({ x: 3.4612, y: 0.3 }, ctx, 0.2)?.point.x).toBeCloseTo(3.46, 9);
  });

  it("finds nothing away from every wall", () => {
    expect(snapToWall({ x: 3, y: 3 }, ctx, 0.2)).toBeNull();
  });
});

describe("drawing a wall", () => {
  const fromBottom = () => {
    const start = snapToWall({ x: 3, y: 0.3 }, ctx, 0.2);
    if (!start) throw new Error("no start");
    return start;
  };

  it("runs from its start to the first wall it meets, both ends on a wall", () => {
    const draft = drawWallTo(fromBottom(), { x: 3.02, y: 4 }, ctx);
    // Close to square: locked straight up, and it meets the top of the outline.
    expect(draft?.segment.a).toEqual({ x: 3, y: 0 });
    expect(draft?.segment.b.x).toBeCloseTo(3, 9);
    expect(draft?.segment.b.y).toBeCloseTo(6, 9);
    expect(draft?.end.target).toEqual({ kind: "outline", index: 2 });
    // Between the inner faces of the two exterior walls.
    expect(draft?.length).toBeCloseTo(6 - 0.6, 9);
    expect(draft?.clear[0].y).toBeCloseTo(0.3, 9);
  });

  it("stops at an interior wall on the way, on its face", () => {
    const start = snapToWall({ x: 0.3, y: 2 }, ctx, 0.2);
    if (!start) throw new Error("no start");
    const draft = drawWallTo(start, { x: 9, y: 2.05 }, ctx);
    expect(draft?.end.target).toEqual({ kind: "wall", index: 0 });
    expect(draft?.segment.b.x).toBeCloseTo(6, 9);
    expect(draft?.clear[1].x).toBeCloseTo(5.95, 9);
    expect(draft?.length).toBeCloseTo(5.95 - 0.3, 9);
  });

  it("keeps a slanted direction when it is not close to a right angle", () => {
    const draft = drawWallTo(fromBottom(), { x: 4, y: 2 }, ctx);
    expect(draft).not.toBeNull();
    expect((draft?.segment.b.x ?? 0) - 3).toBeCloseTo(((draft?.segment.b.y ?? 0) - 0) / 2, 9);
  });

  it("draws nothing out of the building, along its own wall, or on its start", () => {
    expect(drawWallTo(fromBottom(), { x: 3, y: -2 }, ctx)).toBeNull();
    expect(drawWallTo(fromBottom(), { x: 8, y: 0.1 }, ctx)).toBeNull();
    expect(drawWallTo(fromBottom(), { x: 3, y: 0 }, ctx)).toBeNull();
  });

  it("draws nothing shorter than a wall", () => {
    const narrow: WallContext = {
      ...ctx,
      walls: [{ a: { x: 0, y: 0.45 }, b: { x: 10, y: 0.45 } }],
    };
    const start = snapToWall({ x: 3, y: 0.3 }, narrow, 0.05);
    if (!start) throw new Error("no start");
    expect(start.target.kind).toBe("outline");
    const draft = drawWallTo(start, { x: 3, y: 4 }, narrow);
    // 0.1 m between the exterior wall's face and the interior wall's: less than a wall.
    expect(draft).toBeNull();
    expect(MIN_CLEAR_LENGTH).toBeGreaterThan(0.1);
  });
});

describe("openings are not wall ends", () => {
  const withOpenings: WallContext = {
    ...ctx,
    openings: [
      // A window in the bottom exterior wall, from x = 2 to x = 3.2.
      {
        id: "win",
        wallIndex: 0,
        kind: "window",
        offset: 2,
        width: 1.2,
        height: 1.4,
        sill: 0.9,
        constructionId: "w",
      },
      // A door in the interior wall at x = 6, from y = 1 to y = 1.9.
      {
        id: "door",
        wallIndex: 0,
        interior: true,
        kind: "door",
        offset: 1,
        width: 0.9,
        height: 2.1,
        sill: 0,
        constructionId: "d",
      },
    ],
  };

  it("blocks a snap on a window or a door, and not beside it", () => {
    expect(snapToWall({ x: 2.6, y: 0.3 }, withOpenings, 0.2)?.blocked).toBe(true);
    expect(snapToWall({ x: 6.1, y: 1.5 }, withOpenings, 0.2)?.blocked).toBe(true);
    expect(snapToWall({ x: 3.4, y: 0.3 }, withOpenings, 0.2)?.blocked).toBe(false);
    // Half a wall's thickness away from the window's edge is still too close.
    expect(snapToWall({ x: 3.23, y: 0.3 }, withOpenings, 0.2)?.blocked).toBe(true);
  });

  it("draws nothing from an opening, and flags a wall that would end on one", () => {
    const onWindow = snapToWall({ x: 2.6, y: 0.3 }, withOpenings, 0.2);
    if (!onWindow) throw new Error("no snap");
    expect(drawWallTo(onWindow, { x: 2.6, y: 4 }, withOpenings)).toBeNull();
    const left = snapToWall({ x: 0.3, y: 1.5 }, withOpenings, 0.2);
    if (!left) throw new Error("no snap");
    expect(drawWallTo(left, { x: 5, y: 1.5 }, withOpenings)?.blocked).toBe(true);
    expect(drawWallTo(left, { x: 5, y: 2.5 }, withOpenings)?.blocked).toBe(false);
  });
});
