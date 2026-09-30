import { describe, expect, it } from "vitest";
import { exampleHouse } from "@/lib/examples";
import { resetIds } from "@/lib/ids";
import type { Measure } from "./scenarios";
import { heatingCostCap, subsidyOf } from "./subsidy";
import type { Building } from "./types";

function house(economics?: Building["economics"], heating?: Building["heating"]): Building {
  resetIds();
  return {
    ...exampleHouse("en"),
    ...(economics ? { economics } : {}),
    ...(heating ? { heating } : {}),
  };
}

/** Before the climate speed bonus starts to fall in February 2027. */
const SEPTEMBER_2026 = new Date("2026-09-29");

const wall = (cost: number, uValue: number): Measure => ({
  kind: "wall",
  cost,
  sowieso: 0,
  quantity: 100,
  uValue,
});
const pump: Measure = {
  kind: "heating",
  cost: 30_000,
  sowieso: 0,
  quantity: 0,
  heating: { carrier: "heatPumpAir", efficiency: 3, hotWater: 12.5 },
};

describe("BEG EM, building envelope", () => {
  it("pays 15 % on a measure that meets the TMA and nothing on one that does not", () => {
    const s = subsidyOf(house(), [wall(20_000, 0.18), { ...wall(5_000, 0.28), kind: "floor" }]);
    // The floor at 0.28 misses the 0.25 limit for basement ceilings.
    expect(s.measures.map((m) => m.reason)).toEqual(["eligible", "uTooHigh"]);
    expect(s.measures[1]?.limit).toBe(0.25);
    expect(s.envelopeRate).toBe(0.15);
    expect(s.total).toBeCloseTo(3_000);
    expect(s.ownShare).toBeCloseTo(22_000);
  });

  it("adds the iSFP bonus only from 30,000 euro of eligible costs", () => {
    expect(subsidyOf(house({ isfp: true }), [wall(29_000, 0.18)]).envelopeRate).toBe(0.15);
    expect(subsidyOf(house({ isfp: true }), [wall(30_000, 0.18)]).envelopeRate).toBe(0.2);
  });

  it("caps eligible costs at 30,000 euro per dwelling, 60,000 with an iSFP", () => {
    expect(subsidyOf(house(), [wall(50_000, 0.18)]).total).toBeCloseTo(30_000 * 0.15);
    expect(subsidyOf(house({ dwellings: 2 }), [wall(50_000, 0.18)]).total).toBeCloseTo(
      50_000 * 0.15,
    );
    expect(subsidyOf(house({ isfp: true }), [wall(80_000, 0.18)]).total).toBeCloseTo(60_000 * 0.2);
  });
});

describe("KfW 458, heating", () => {
  it("pays 30 % plus the climate speed bonus to an owner-occupier replacing gas", () => {
    const s = subsidyOf(house(), [pump], SEPTEMBER_2026);
    expect(s.heatingRate).toBeCloseTo(0.46);
    expect(s.total).toBeCloseTo(30_000 * 0.46);
  });

  it("pays a landlord the base rate only", () => {
    expect(
      subsidyOf(house({ ownerOccupied: false }), [pump], SEPTEMBER_2026).heatingRate,
    ).toBeCloseTo(0.3);
  });

  it("pays nothing for a new gas boiler", () => {
    const gas: Measure = { ...pump, heating: { carrier: "gas", efficiency: 0.95, hotWater: 12.5 } };
    const s = subsidyOf(
      house({}, { carrier: "oil", efficiency: 0.8, hotWater: 12.5 }),
      [gas],
      SEPTEMBER_2026,
    );
    expect(s.measures[0]?.reason).toBe("notRenewable");
    expect(s.total).toBe(0);
  });

  it("caps eligible costs by the number of dwellings", () => {
    expect(heatingCostCap(1)).toBe(30_000);
    expect(heatingCostCap(2)).toBe(45_000);
    expect(heatingCostCap(6)).toBe(105_000);
    expect(heatingCostCap(8)).toBe(121_000);
    const big = subsidyOf(house(), [{ ...pump, cost: 50_000 }], SEPTEMBER_2026);
    expect(big.total).toBeCloseTo(30_000 * 0.46);
  });

  it("lowers the climate speed bonus step by step from February 2027", () => {
    const rate = (day: string) => subsidyOf(house(), [pump], new Date(day)).heatingRate;
    expect(rate("2027-01-31")).toBeCloseTo(0.46);
    expect(rate("2027-02-01")).toBeCloseTo(0.42);
    expect(rate("2027-08-01")).toBeCloseTo(0.38);
    expect(rate("2028-02-01")).toBeCloseTo(0.34);
    expect(rate("2028-08-01")).toBeCloseTo(0.3);
  });
});
