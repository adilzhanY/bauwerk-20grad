import { describe, expect, it } from "vitest";
import { cutPlane, signedDistance } from "./clipping";

describe("cutPlane", () => {
  it("a horizontal cut at 4.2 keeps points below and hides points above", () => {
    const p = cutPlane("horizontal", 4.2);
    expect(p.constant).toBe(4.2);
    expect(signedDistance(p, [0, 1, 0])).toBeGreaterThan(0);
    expect(signedDistance(p, [0, 4.2, 0])).toBeCloseTo(0);
    expect(signedDistance(p, [0, 5, 0])).toBeLessThan(0);
  });

  it("cuts along x and y follow the plan axes", () => {
    const x = cutPlane("x", 3);
    expect(signedDistance(x, [2, 0, 0])).toBeGreaterThan(0);
    expect(signedDistance(x, [4, 0, 0])).toBeLessThan(0);
    const y = cutPlane("y", 3);
    // Plan y is world -z: plan y = 2 is kept, plan y = 4 is cut away.
    expect(signedDistance(y, [0, 0, -2])).toBeGreaterThan(0);
    expect(signedDistance(y, [0, 0, -4])).toBeLessThan(0);
  });
});
