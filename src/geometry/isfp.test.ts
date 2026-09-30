import { describe, expect, it } from "vitest";
import { exampleHouse } from "@/lib/examples";
import { resetIds } from "@/lib/ids";
import { computeEnergy } from "./energy";
import {
  REFERENCE_U,
  consumptionOf,
  currentConsumption,
  ehCheck,
  isfpClass,
  referenceBuilding,
  typicalConsumption,
  typicalFactor,
} from "./isfp";
import { supplyOf } from "./supply";
import type { Building } from "./types";

function house(patch: Partial<Building> = {}): Building {
  resetIds();
  return { ...exampleHouse("en"), ...patch };
}

describe("iSFP colour class", () => {
  it("puts primary energy into the seven colours at 30, 60, 90, 130, 180 and 230", () => {
    expect(isfpClass(30)).toBe(0);
    expect(isfpClass(30.1)).toBe(1);
    expect(isfpClass(90)).toBe(2);
    expect(isfpClass(130)).toBe(3);
    expect(isfpClass(180)).toBe(4);
    expect(isfpClass(230)).toBe(5);
    expect(isfpClass(231)).toBe(6);
  });
});

describe("Effizienzhaus level, envelope side", () => {
  it("measures H'T against the same building with the GEG reference U-values", () => {
    const b = house();
    const ref = referenceBuilding(b);
    const wall = ref.constructions.find((c) => c.id === ref.wallConstructionId);
    expect(wall?.uValue).toBe(REFERENCE_U.wall);
    // The reference building is exactly at 100 %: Effizienzhaus 85 on the envelope side.
    const self = ehCheck(ref);
    expect(self.ratio).toBeCloseTo(1);
    expect(self.level).toBe("85");
    // The uninsulated example is far above every level.
    const old = ehCheck(b);
    expect(old.ratio).toBeGreaterThan(1.6);
    expect(old.level).toBeNull();
  });
});

describe("expected consumption", () => {
  it("follows the iSFP typical consumption formula", () => {
    expect(typicalFactor(250)).toBeCloseTo(-0.2 + 1.3 / 1.5);
    expect(typicalConsumption(250)).toBeCloseTo(30 + typicalFactor(250) * 220);
    expect(typicalConsumption(50)).toBeCloseTo(((1 + typicalFactor(50)) / 2) * 50);
    // Never below 0.4.
    expect(typicalFactor(5000)).toBe(0.4);
  });

  it("expects an uninsulated house to use less than calculated", () => {
    const c = currentConsumption(house());
    expect(c.source).toBe("typical");
    expect(c.factor).toBeLessThan(0.8);
    expect(c.expected).toBeLessThan(c.calculated);
  });

  it("lets measured bills set the level for the building and its variants", () => {
    const b = house({ economics: { consumption: 20_000 } });
    const today = currentConsumption(b);
    expect(today.source).toBe("bills");
    expect(today.expected).toBeCloseTo(20_000);
    // A variant with half the demand keeps the same relation to its typical consumption.
    const variant: Building = {
      ...b,
      heating: { carrier: "gas", efficiency: 0.92, hotWater: 12.5 },
    };
    const e = computeEnergy(variant);
    const s = supplyOf(variant, e);
    const withBills = consumptionOf(variant, s, e, {
      building: b,
      supply: supplyOf(b),
      energy: computeEnergy(b),
    });
    const typical = consumptionOf({ ...variant, economics: {} }, s, e);
    expect(withBills.expected / typical.expected).toBeCloseTo(
      20_000 / currentConsumption({ ...b, economics: {} }).expected,
    );
  });
});
