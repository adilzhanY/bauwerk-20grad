import { describe, expect, it } from "vitest";
import { ENERGY_CLASS_COLORS } from "@/geometry/energy";
import { ENERGY_CLASS_INK, ENERGY_CLASS_ORDER, contrast } from "./energyClassInk";

describe("energy class letters", () => {
  it("are readable on every class colour (WCAG AA for large bold text, 3:1)", () => {
    for (const id of ENERGY_CLASS_ORDER) {
      expect(contrast(ENERGY_CLASS_COLORS[id], ENERGY_CLASS_INK[id])).toBeGreaterThanOrEqual(3);
    }
  });

  it("are white on the dark red of H and dark on the yellow of D", () => {
    expect(ENERGY_CLASS_INK.H).toBe("#ffffff");
    expect(ENERGY_CLASS_INK.D).toBe("#0d2137");
    expect(ENERGY_CLASS_ORDER[0]).toBe("A+");
    expect(ENERGY_CLASS_ORDER.at(-1)).toBe("H");
  });
});
