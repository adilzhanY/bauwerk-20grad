import { describe, expect, it } from "vitest";
import { solarGains } from "./solarGains";

describe("solar gains", () => {
  it("a south window gains more than a north window and gains scale with area times g", () => {
    // 1.68 m² of double thermal glazing, g 0.6.
    const south = solarGains({ N: 0, E: 0, S: 1.68 * 0.6, W: 0 });
    const north = solarGains({ N: 1.68 * 0.6, E: 0, S: 0, W: 0 });
    expect(south).toBeGreaterThan(north * 2);
    expect(solarGains({ N: 0, E: 0, S: 3.36 * 0.6, W: 0 })).toBeCloseTo(south * 2);
    // F_W 0.9, F_F 0.7, F_S 0.9, I 270, utilisation 0.95.
    expect(south).toBeCloseTo(1.68 * 0.6 * 0.9 * 0.7 * 0.9 * 270 * 0.95);
  });
});
