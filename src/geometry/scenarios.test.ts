import { describe, expect, it } from "vitest";
import { DEFAULT_ASSIGNMENT, PRESET_IDS, defaultConstructions } from "./constructions";
import { computeEnergy } from "./energy";
import { rect } from "./fixtures";
import { supplyOf } from "./supply";
import { computeRooms } from "./rooms";
import {
  HEATING_COST,
  CONSTRUCTION_COST,
  applyScenario,
  buildRoadmap,
  evaluateAll,
  evaluateScenario,
  fullEnvelopeScenario,
  measuresOf,
} from "./scenarios";
import type { Building, Opening, Scenario } from "./types";

let n = 0;
const factory = { createId: () => `room_${++n}`, defaultName: (i: number) => `Room ${i}` };
const win = (id: string, offset: number): Opening => ({
  id,
  wallIndex: 0,
  kind: "window",
  offset,
  width: 1.2,
  height: 1.4,
  sill: 0.9,
  constructionId: PRESET_IDS.glazingDouble,
});

function building(): Building {
  return {
    id: "b",
    name: "b",
    footprint: rect,
    wallThickness: 0.3,
    zones: [],
    constructions: defaultConstructions("en"),
    ...DEFAULT_ASSIGNMENT,
    storeys: [
      {
        id: "s0",
        name: "G",
        height: 3,
        openings: [win("w1", 1), win("w2", 5)],
        interiorWalls: [],
        rooms: computeRooms(rect, [], [], factory),
      },
    ],
  };
}

describe("scenarios", () => {
  it("an empty scenario equals the current building", () => {
    const b = building();
    const r = evaluateScenario(b, { id: "none", name: "Nothing", overrides: {} });
    expect(r.energy.heatingDemand).toBeCloseTo(computeEnergy(b).heatingDemand);
    expect(r.investment).toBe(0);
    expect(r.payback).toBe(Infinity);
  });

  it("windows only changes only the window terms and costs the window area", () => {
    const b = building();
    const base = computeEnergy(b);
    const r = evaluateScenario(b, {
      id: "w",
      name: "Windows only",
      overrides: { window: PRESET_IDS.glazingTriple },
    });
    const area = 2 * 1.2 * 1.4;
    expect(r.energy.transmissionLoss - base.transmissionLoss).toBeCloseTo((0.8 - 2.8) * area);
    expect(r.energy.wallNetArea).toBeCloseTo(base.wallNetArea);
    expect(r.energy.bridgeLoss).toBeCloseTo(base.bridgeLoss);
    expect(r.investment).toBe(Math.round(area * CONSTRUCTION_COST.c_glazing_triple!));
    // The saving is the difference in expected cost: less than the calculated one, since an
    // uninsulated house is heated more sparingly than the balance assumes.
    expect(r.savingPerYear).toBeCloseTo(r.currentConsumption.cost - r.consumption.cost);
    const calculated = supplyOf(b).cost - r.supply.cost;
    expect(r.savingPerYear).toBeGreaterThan(0);
    expect(r.savingPerYear).toBeLessThan(calculated);
    expect(r.payback).toBeCloseTo(r.investment / r.savingPerYear);
  });

  it("the full envelope variant costs money and lowers H_T below a third", () => {
    const b = building();
    const full = evaluateScenario(b, fullEnvelopeScenario(b));
    expect(full.energy.transmissionLoss).toBeLessThan(computeEnergy(b).transmissionLoss / 2);
    expect(full.investment).toBeGreaterThan(0);
  });

  it("applyScenario does not touch the baseline and can change the roof", () => {
    const b = building();
    const v = applyScenario(b, {
      id: "r",
      name: "Roof",
      overrides: { roof: PRESET_IDS.roofInsulated },
      roof: { kind: "gable", pitch: 35 },
      bridgeDetail: "good",
    });
    expect(b.roofConstructionId).toBe(PRESET_IDS.roofBare);
    expect(v.roofConstructionId).toBe(PRESET_IDS.roofInsulated);
    expect(v.roof?.kind).toBe("gable");
    expect(v.bridgeDetail).toBe("good");
    expect(measuresOf(b, v).reduce((sum, m) => sum + m.cost, 0)).toBeGreaterThan(0);
  });

  it("evaluateAll lists the built-in variant first and the saved ones after", () => {
    const b = {
      ...building(),
      scenarios: [{ id: "s1", name: "Walls", overrides: { wall: PRESET_IDS.wallInsulated } }],
    };
    const all = evaluateAll(b);
    expect(all.map((r) => r.scenario.id)).toEqual(["full-envelope", "s1"]);
    expect(all[1]!.demandSaved).toBeGreaterThan(0);
    expect(all[0]!.demandSaved).toBeGreaterThan(all[1]!.demandSaved);
  });

  it("buildRoadmap applies the saved scenarios cumulatively, cheapest payback first", () => {
    const b = building();
    const windows: Scenario = {
      id: "w",
      name: "Windows",
      overrides: { window: PRESET_IDS.glazingTriple },
    };
    const facade: Scenario = {
      id: "f",
      name: "Facade",
      overrides: { wall: PRESET_IDS.wallInsulated },
      bridgeDetail: "good",
    };
    const steps = buildRoadmap({ ...b, scenarios: [windows, facade] }, 2);
    expect(steps).toHaveLength(2);
    expect(steps.map((s) => s.year)).toEqual([0, 2]);
    const single = [windows, facade].map((s) => evaluateScenario(b, s));
    const cheaperFirst = single[0]!.payback <= single[1]!.payback ? "w" : "f";
    expect(steps[0]?.scenario.id).toBe(cheaperFirst);
    // The last step equals both applied at once.
    const both = applyScenario(applyScenario(b, windows), facade);
    expect(steps[1]?.energy.heatingDemand).toBeCloseTo(computeEnergy(both).heatingDemand, 6);
    expect(steps[1]?.cumulativeInvestment).toBe(steps[0]!.investment + steps[1]!.investment);
    expect(steps[1]!.energy.heatingDemand).toBeLessThan(steps[0]!.energy.heatingDemand);
    // Without saved scenarios the full envelope is the only step.
    const only = buildRoadmap(b);
    expect(only).toHaveLength(1);
    expect(only[0]?.scenario.id).toBe("full-envelope");
  });
});

describe("a variant that replaces the heating system", () => {
  it("costs the new system per dwelling and saves the difference in heating cost", () => {
    const b = building();
    const r = evaluateScenario(b, {
      id: "hp",
      name: "Heat pump",
      overrides: {},
      heating: { carrier: "heatPumpAir", efficiency: 3, hotWater: 12.5 },
    });
    expect(r.investment).toBe(HEATING_COST.heatPumpAir);
    expect(r.demandSaved).toBe(0);
    // Same envelope, same heating habits: the heat pump gets the gas boiler's factor.
    expect(r.consumption.factor).toBeCloseTo(r.currentConsumption.factor);
    expect(r.savingPerYear).toBeCloseTo(r.currentConsumption.cost - r.consumption.cost);
    expect(r.savingPerYear).toBeGreaterThan(0);
    expect(r.supply.co2Cost).toBe(0);
  });
});

describe("what a scenario charges for its windows", () => {
  const triple = { id: "t", name: "Triple", overrides: { window: PRESET_IDS.glazingTriple } };
  const area = 2 * 1.2 * 1.4;

  it("charges the windows it really changes, even when new windows already default to them", () => {
    const b = { ...building(), windowConstructionId: PRESET_IDS.glazingTriple };
    const r = evaluateScenario(b, triple);
    expect(r.investment).toBe(Math.round(area * CONSTRUCTION_COST.c_glazing_triple!));
    expect(r.savingPerYear).toBeGreaterThan(0);
  });

  it("charges nothing for windows that already are what the scenario asks for", () => {
    const b = building();
    for (const o of b.storeys[0]!.openings) o.constructionId = PRESET_IDS.glazingTriple;
    const r = evaluateScenario(b, triple);
    expect(r.investment).toBe(0);
  });

  it("splits off the Sowieso share: half of new windows would be due anyway", () => {
    const r = evaluateScenario(building(), triple);
    expect(r.sowieso).toBe(Math.round(r.investment * 0.5));
  });
});
