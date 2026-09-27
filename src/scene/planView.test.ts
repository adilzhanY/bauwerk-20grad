import { describe, expect, it } from "vitest";
import { rect } from "@/geometry/fixtures";
import { bounds } from "@/geometry/polygon";
import { planCamera, planPointFromScreen } from "./planView";

describe("plan camera", () => {
  it("centres over the footprint and fits it with a margin", () => {
    const cam = planCamera(bounds(rect), { width: 1400, height: 800 }, 3);
    // Plan y is world -z.
    expect(cam.position).toEqual([5, 53, -4]);
    expect(cam.target).toEqual([5, 3, -4]);
    // 14 m by 12 m with margin; height is the limiting side: 800 / 12
    expect(cam.zoom).toBeCloseTo(800 / 12);
  });

  it("maps the viewport centre to the footprint centre and scales by zoom", () => {
    const viewport = { width: 1400, height: 800 };
    const cam = planCamera(bounds(rect), viewport, 0);
    expect(planPointFromScreen(cam, viewport, 700, 400)).toEqual({ x: 5, y: 4 });
    const right = planPointFromScreen(cam, viewport, 700 + cam.zoom, 400);
    expect(right.x).toBeCloseTo(6);
    // North is up on the screen, so down the screen is south: plan y falls.
    const down = planPointFromScreen(cam, viewport, 700, 400 + cam.zoom * 2);
    expect(down.y).toBeCloseTo(2);
  });

  it("fits into the space the cards leave and centres the drawing there", () => {
    const viewport = { width: 1000, height: 800 };
    const insets = { left: 200, right: 0, top: 100, bottom: 0 };
    const cam = planCamera(bounds(rect), viewport, 0, 2, insets);
    // 14 m by 12 m into 800 by 700 px: the width limits, 800 / 14.
    expect(cam.zoom).toBeCloseTo(800 / 14);
    // The footprint centre lands in the middle of the free area, not of the viewport.
    const centre = planPointFromScreen(cam, viewport, 200 + 800 / 2, 100 + 700 / 2);
    expect(centre.x).toBeCloseTo(5);
    expect(centre.y).toBeCloseTo(4);
  });
});
