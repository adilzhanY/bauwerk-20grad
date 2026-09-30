import { describe, expect, it } from "vitest";
import type { Quad } from "lod2-core/photo";
import { sameCorners } from "@/components/photo-editor/images";

const quad = (dx = 0): Quad => [
  { x: 100 + dx, y: 100 },
  { x: 900, y: 110 },
  { x: 910, y: 1200 },
  { x: 95, y: 1190 },
];

describe("sameCorners", () => {
  it("tells a moved corner from an unchanged one", () => {
    expect(sameCorners(quad(), quad())).toBe(true);
    // Rounding in the dot's position is not a move.
    expect(sameCorners(quad(), quad(0.04))).toBe(true);
    // A dot dragged by a pixel is: the wall picture changes and its openings are found again.
    expect(sameCorners(quad(), quad(1))).toBe(false);
  });
});
