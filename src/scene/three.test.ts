import { describe, expect, it } from "vitest";
import { Box3, Mesh } from "three";
import { rect } from "@/geometry/fixtures";
import { flatGeometry, mergeAll, prismGeometry, yawFor } from "./three";

describe("scene geometry helpers", () => {
  it("mergeAll gives null for nothing to merge: a wall with no solid left", () => {
    expect(mergeAll([])).toBeNull();
  });

  it("prismGeometry stands on the XZ plane between bottom and top", () => {
    const box = new Box3().setFromObject(new Mesh(prismGeometry(rect, 3, 5.8)));
    expect(box.min.x).toBeCloseTo(0);
    expect(box.max.x).toBeCloseTo(10);
    expect(box.min.z).toBeCloseTo(0);
    expect(box.max.z).toBeCloseTo(8);
    expect(box.min.y).toBeCloseTo(3);
    expect(box.max.y).toBeCloseTo(5.8);
  });

  it("flatGeometry lies at the given height", () => {
    const box = new Box3().setFromObject(new Mesh(flatGeometry(rect, 1.5)));
    expect(box.min.y).toBeCloseTo(1.5);
    expect(box.max.y).toBeCloseTo(1.5);
    expect(box.max.z).toBeCloseTo(8);
  });

  it("yawFor turns local +X into the plan direction", () => {
    expect(yawFor({ x: 1, y: 0 })).toBeCloseTo(0);
    // Plan +y is world +z; rotating +X to +Z is a yaw of -90 degrees.
    expect(yawFor({ x: 0, y: 1 })).toBeCloseTo(-Math.PI / 2);
    expect(Math.abs(yawFor({ x: -1, y: 0 }))).toBeCloseTo(Math.PI);
  });
});
