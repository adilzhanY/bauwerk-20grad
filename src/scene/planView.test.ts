import { describe, expect, it } from "vitest";
import { rect } from "@/geometry/fixtures";
import { bounds } from "@/geometry/polygon";
import { planCamera } from "./planView";

describe("plan camera", () => {
  it("centres over the footprint and fits it with a margin", () => {
    const cam = planCamera(bounds(rect), { width: 1400, height: 800 }, 3);
    // Plan y is world -z.
    expect(cam.position).toEqual([5, 53, -4]);
    expect(cam.target).toEqual([5, 3, -4]);
    // 14 m by 12 m with margin; height is the limiting side: 800 / 12
    expect(cam.zoom).toBeCloseTo(800 / 12);
  });

  it("fits into the space the cards leave and centres the drawing there", () => {
    const viewport = { width: 1000, height: 800 };
    const insets = { left: 200, right: 0, top: 100, bottom: 0 };
    const cam = planCamera(bounds(rect), viewport, 0, 2, insets);
    // 14 m by 12 m into 800 by 700 px: the width limits, 800 / 14.
    expect(cam.zoom).toBeCloseTo(800 / 14);
    // The camera moves the other way, so the footprint centre lands in the middle of the free
    // area: 100 px left and 50 px up of the viewport centre.
    expect(cam.position[0]).toBeCloseTo(5 - 100 / cam.zoom);
    expect(cam.position[2]).toBeCloseTo(-4 - 50 / cam.zoom);
  });
});
