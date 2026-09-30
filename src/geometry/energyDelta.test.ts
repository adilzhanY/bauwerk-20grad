import { describe, expect, it } from "vitest";
import { exampleAltbau } from "@/lib/examples";
import { resetIds } from "@/lib/ids";
import { computeEnergy } from "./energy";
import { energyDelta } from "./energyDelta";
import { supplyOf } from "./supply";
import type { Building } from "./types";

const result = (b: Building) => {
  const energy = computeEnergy(b);
  return { energy, supply: supplyOf(b, energy) };
};

describe("energyDelta", () => {
  it("says nothing when nothing moved", () => {
    resetIds();
    const b = exampleAltbau("en");
    expect(energyDelta(result(b), result(b))).toEqual([]);
  });

  it("tells a new street window: more glass, more loss, and what it does to the energy", () => {
    resetIds();
    const b = exampleAltbau("en");
    const withWindow: Building = {
      ...b,
      storeys: b.storeys.map((s, i) =>
        i === 0
          ? {
              ...s,
              openings: [
                ...s.openings,
                {
                  id: "new",
                  wallIndex: 1,
                  kind: "window",
                  offset: 5,
                  width: 1.2,
                  height: 1.6,
                  sill: 0.85,
                  constructionId: b.windowConstructionId,
                },
              ],
            }
          : s,
      ),
    };
    const items = energyDelta(result(b), result(withWindow));
    const window = items.find((i) => i.key === "windowArea");
    expect(window?.delta).toBeCloseTo(1.92);
    expect(items.some((i) => i.key === "transmissionLoss")).toBe(true);
    expect(items.some((i) => i.key === "referenceArea")).toBe(false);
  });
});
