import { describe, expect, it } from "vitest";
import {
  CARRIERS,
  DEFAULT_HEATING,
  DISTRIBUTION_LOSS,
  endEnergyOf,
  hotWaterEfficiencyOf,
  primaryFactor,
} from "./heating";
import type { HeatingSystem } from "./types";

const gas: HeatingSystem = { carrier: "gas", efficiency: 0.92, hotWater: 12.5 };

describe("endEnergyOf", () => {
  it("adds distribution losses, divides by the efficiency and adds the auxiliary power", () => {
    // 10 000 kWh demand on 100 m² A_N with a gas boiler:
    //   heating   10 000 x 1.1 / 0.92                        = 11 956.5
    //   hot water 12.5 x 100 x 1.1 / (0.92 x 0.85 / 0.92)    =  1 617.6
    //   auxiliary 1.5 x 100                                  =    150
    const e = endEnergyOf(gas, 10_000, 100);
    expect(e.heating).toBeCloseTo((10_000 * 1.1) / 0.92, 6);
    expect(e.hotWater).toBeCloseTo((12.5 * 100 * 1.1) / 0.85, 6);
    expect(e.auxiliary).toBeCloseTo(150, 6);
    expect(e.total).toBeCloseTo(e.heating + e.hotWater + e.auxiliary, 9);
  });

  it("clamps an efficiency of zero or below to 0.1 instead of dividing by it", () => {
    const broken = { ...gas, efficiency: 0, hotWaterEfficiency: -1 };
    const e = endEnergyOf(broken, 1000, 10);
    expect(Number.isFinite(e.total)).toBe(true);
    expect(e.heating).toBeCloseTo((1000 * (1 + DISTRIBUTION_LOSS)) / 0.1, 6);
    expect(e.hotWater).toBeCloseTo((12.5 * 10 * (1 + DISTRIBUTION_LOSS)) / 0.1, 6);
  });

  it("lets a heat pump deliver more heat than it draws", () => {
    const pump: HeatingSystem = { carrier: "heatPumpAir", efficiency: 3, hotWater: 12.5 };
    const e = endEnergyOf(pump, 9000, 100);
    expect(e.heating).toBeCloseTo((9000 * 1.1) / 3, 6);
    expect(e.heating).toBeLessThan(9000);
  });

  it("uses an entered distribution loss", () => {
    const tight = endEnergyOf({ ...gas, distributionLoss: 0 }, 1000, 0);
    expect(tight.heating).toBeCloseTo(1000 / 0.92, 6);
  });

  it("decides the energy class: a better boiler lowers the end energy", () => {
    const old = endEnergyOf({ ...gas, efficiency: 0.7 }, 10_000, 100).total;
    const condensing = endEnergyOf({ ...gas, efficiency: 0.98 }, 10_000, 100).total;
    expect(condensing).toBeLessThan(old);
  });
});

describe("hotWaterEfficiencyOf", () => {
  it("takes an entered value", () => {
    expect(hotWaterEfficiencyOf({ ...gas, hotWaterEfficiency: 0.5 })).toBe(0.5);
  });

  it("otherwise scales the heating efficiency by the carrier's ratio", () => {
    const c = CARRIERS.heatPumpGround;
    const pump: HeatingSystem = { carrier: "heatPumpGround", efficiency: 4.4, hotWater: 12.5 };
    expect(hotWaterEfficiencyOf(pump)).toBeCloseTo(4.4 * (c.hotWaterEfficiency / c.efficiency));
    expect(hotWaterEfficiencyOf(DEFAULT_HEATING)).toBeCloseTo(CARRIERS.gas.hotWaterEfficiency);
  });
});

describe("primaryFactor", () => {
  it("follows the GEG 2024 set and the GModG 2027 changes", () => {
    expect(primaryFactor("heatPumpAir", "geg2024")).toBe(1.8);
    expect(primaryFactor("heatPumpAir", "gmodg2027")).toBe(1.5);
    expect(primaryFactor("pellets", "geg2024")).toBe(0.2);
    expect(primaryFactor("pellets", "gmodg2027")).toBe(0.7);
    // Unchanged by the GModG: the 2024 value.
    expect(primaryFactor("gas", "gmodg2027")).toBe(1.1);
  });
});
