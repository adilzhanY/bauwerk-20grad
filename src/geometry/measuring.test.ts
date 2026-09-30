import { describe, expect, it } from "vitest";
import { measurePoint } from "./measuring";
import type { WallContext } from "./wallDrawing";

// A 10 x 6 building, exterior walls 0.3 thick, one interior wall at x = 6.
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

describe("the measure tool's points", () => {
  it("lies on the face of the wall near the pointer", () => {
    const p = measurePoint({ x: 2.345, y: 0.4 }, ctx, 0.2);
    expect(p.y).toBeCloseTo(0.3, 9);
    expect(p.x).toBeCloseTo(2.35, 9);
    const q = measurePoint({ x: 5.9, y: 3 }, ctx, 0.2);
    expect(q.x).toBeCloseTo(5.95, 9);
  });

  it("is free anywhere else, inside or outside the building, to the centimetre", () => {
    expect(measurePoint({ x: 3.1234, y: 2.5678 }, ctx, 0.2)).toEqual({ x: 3.12, y: 2.57 });
    expect(measurePoint({ x: -4.001, y: 12.349 }, ctx, 0.2)).toEqual({ x: -4, y: 12.35 });
  });

  it("measures wall to wall square when the line is close to straight", () => {
    const from = measurePoint({ x: 0.35, y: 2 }, ctx, 0.2);
    expect(from.x).toBeCloseTo(0.3, 9);
    // Slightly off straight, near the interior wall: it ends square on its face.
    const to = measurePoint({ x: 5.9, y: 2.2 }, ctx, 0.2, from);
    expect(to.y).toBeCloseTo(2, 9);
    expect(to.x).toBeCloseTo(5.95, 9);
  });

  it("keeps a slanted line where it is pointed", () => {
    const to = measurePoint({ x: 3, y: 4 }, ctx, 0.2, { x: 1, y: 1 });
    expect(to).toEqual({ x: 3, y: 4 });
  });
});
