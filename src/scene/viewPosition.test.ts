import { describe, expect, it } from "vitest";
import { PerspectiveCamera, Vector3 } from "three";
import { planToWorld } from "./three";
import { shouldApplyView, viewPosition } from "./viewPosition";

/** Where a plan point lands on screen (normalised, x right, y up) from a view of the origin. */
function onScreen(view: "s" | "n" | "top", point: { x: number; y: number }) {
  const centre = new Vector3(0, 0, 0);
  const camera = new PerspectiveCamera(45, 1, 0.1, 500);
  camera.position.copy(viewPosition(view, centre, 20, undefined));
  camera.lookAt(centre);
  camera.updateMatrixWorld();
  return planToWorld(point).project(camera);
}

// Plan +y is north and +x is east when the building has no rotation.
describe("the 3D scene reads like the map", () => {
  it("seen from the south, east is on the right", () => {
    expect(onScreen("s", { x: 5, y: 0 }).x).toBeGreaterThan(0);
  });

  it("seen from the north, east is on the left", () => {
    expect(onScreen("n", { x: 5, y: 0 }).x).toBeLessThan(0);
  });

  it("from the top, north is up and east is right", () => {
    expect(onScreen("top", { x: 0, y: 5 }).y).toBeGreaterThan(0);
    expect(onScreen("top", { x: 5, y: 0 }).x).toBeGreaterThan(0);
  });
});

describe("shouldApplyView", () => {
  it("moves the camera once per view choice", () => {
    expect(shouldApplyView(1, 0, false, false)).toBe(true);
    // The same choice again, as when the controls are replaced: no.
    expect(shouldApplyView(1, 1, false, false)).toBe(false);
    expect(shouldApplyView(0, 0, false, false)).toBe(false);
  });

  it("never moves the floor plan's camera", () => {
    // Switching the floor plan on replaces the controls while an earlier choice is on record.
    expect(shouldApplyView(3, 2, true, true)).toBe(false);
    // Right after switching back, the plan's orthographic camera may still be the default.
    expect(shouldApplyView(3, 2, false, true)).toBe(false);
    expect(shouldApplyView(3, 2, false, false)).toBe(true);
  });
});
