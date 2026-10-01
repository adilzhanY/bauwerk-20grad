import { describe, expect, it } from "vitest";
import { pictureView, streetEdge } from "./pictureView";
import type { Opening, Storey } from "./types";

// 20 m along x, 8 m deep, counter-clockwise: edge 0 south, 1 east, 2 north, 3 west.
const box = [
  { x: 0, y: 0 },
  { x: 20, y: 0 },
  { x: 20, y: 8 },
  { x: 0, y: 8 },
];
const opening = (wallIndex: number, kind: "door" | "window" = "window") =>
  ({ id: `${kind}${String(wallIndex)}`, kind, wallIndex }) as unknown as Opening;
const storey = (...openings: Opening[]) => ({ openings }) as unknown as Storey;

describe("streetEdge", () => {
  it("takes the wall with the facade photo, unless it is shared", () => {
    const building = { footprint: box, storeys: [], sharedEdges: [1] };
    expect(streetEdge(building, [3])).toBe(3);
    expect(streetEdge(building, [1, 2])).toBe(2);
  });

  it("else the outside wall with the most openings, a door counting more, never a shared one", () => {
    const building = {
      footprint: box,
      storeys: [
        storey(opening(0), opening(0), opening(2, "door"), opening(1), opening(1), opening(1)),
      ],
      sharedEdges: [1, 3],
    };
    expect(streetEdge(building)).toBe(2);
  });

  it("else the longest outside wall", () => {
    expect(streetEdge({ footprint: box, storeys: [], sharedEdges: [0] })).toBe(2);
  });
});

describe("pictureView", () => {
  it("stands outside the front wall, turned, above, and far enough for the whole building", () => {
    const view = pictureView(box, 0, 12);
    if (!view) throw new Error("no view");
    expect(view.target).toEqual({ x: 10, y: 4, h: 6 });
    // South of the building, a bit to one side, and above the middle.
    expect(view.eye.y).toBeLessThan(0);
    expect(view.eye.x).not.toBeCloseTo(10);
    expect(view.eye.h).toBeGreaterThan(view.target.h);
    const distance = Math.hypot(view.eye.x - 10, view.eye.y - 4, view.eye.h - 6);
    expect(distance).toBeGreaterThan(Math.hypot(20, 8, 12) / 2 / Math.sin((15 * Math.PI) / 180));
  });

  it("finds the outside whichever way the outline runs", () => {
    // Clockwise: edge 0 runs west along the north side.
    const clockwise = [box[3], box[2], box[1], box[0]] as typeof box;
    const view = pictureView(clockwise, 0, 12);
    expect(view?.eye.y).toBeGreaterThan(8);
    expect(pictureView(box, 1, 12)?.eye.x).toBeGreaterThan(20);
  });

  it("needs an outline", () => {
    expect(pictureView([], 0, 3)).toBeNull();
  });
});
