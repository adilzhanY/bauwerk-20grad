import { describe, expect, it } from "vitest";
import { exampleHouse } from "@/lib/examples";
import { resetIds } from "@/lib/ids";
import { CARRIERS, landlordCo2Share, supplyOf } from "./supply";
import type { Building } from "./types";

/** A building whose balance is given: 10,000 kWh/a heating demand on 100 m² A_N. */
const energy = { heatingDemand: 10_000, referenceArea: 100 };
/** No distribution loss and hot water at the heating efficiency: the arithmetic stays plain. */
const plain = { distributionLoss: 0 };

function withHeating(heating: Building["heating"], economics?: Building["economics"]): Building {
  resetIds();
  return { ...exampleHouse("en"), heating, ...(economics ? { economics } : {}) };
}

describe("supplyOf", () => {
  it("turns demand and hot water into end energy, primary energy and CO2 for a gas boiler", () => {
    const s = supplyOf(
      withHeating({
        carrier: "gas",
        efficiency: 0.9,
        hotWater: 12.5,
        hotWaterEfficiency: 0.9,
        ...plain,
      }),
      energy,
    );
    // Gas: (10,000 + 12.5 x 100) / 0.9 = 12,500 kWh/a; pumps and burner: 1.5 x 100 kWh electricity.
    expect(s.hotWater).toBeCloseTo(1250);
    expect(s.endParts.heating + s.endParts.hotWater).toBeCloseTo(12_500);
    expect(s.endParts.auxiliary).toBeCloseTo(150);
    expect(s.endEnergy).toBeCloseTo(12_650);
    expect(s.primaryEnergy).toBeCloseTo(12_500 * 1.1 + 150 * 1.8);
    expect(s.co2).toBeCloseTo(12_500 * 0.24 + 150 * 0.56);
    expect(s.endPerM2).toBeCloseTo(126.5);
    expect(s.energyClass).toBe("D"); // 100 to 130 kWh/m²a
    expect(s.cost).toBeCloseTo(12_500 * 0.11 + 150 * 0.35);
    // Billed CO2 on the gas only: 12,500 x 0.182 = 2,275 kg; at 60 euro/t plus VAT.
    expect(s.co2Cost).toBeCloseTo(2.275 * 60 * 1.19);
  });

  it("gives a heat pump a fraction of the end energy and no CO2 price", () => {
    const s = supplyOf(
      withHeating({
        carrier: "heatPumpAir",
        efficiency: 3.2,
        hotWater: 12.5,
        hotWaterEfficiency: 3.2,
        ...plain,
      }),
      energy,
    );
    expect(s.endEnergy).toBeCloseTo(11_250 / 3.2 + 50);
    expect(s.primaryEnergy).toBeCloseTo((11_250 / 3.2 + 50) * 1.8);
    expect(s.co2Cost).toBe(0);
    expect(s.energyClass).toBe("A"); // about 36 kWh/m²a
  });

  it("counts electricity at 1.5 and biomass at 0.7 with the GModG factors of 2027", () => {
    const pump = withHeating({
      carrier: "heatPumpAir",
      efficiency: 3.2,
      hotWater: 12.5,
      hotWaterEfficiency: 3.2,
      ...plain,
    });
    const s2027 = supplyOf({ ...pump, factorSet: "gmodg2027" }, energy);
    expect(s2027.primaryEnergy).toBeCloseTo((11_250 / 3.2 + 50) * 1.5);
    const pellets = withHeating({ carrier: "pellets", efficiency: 1, hotWater: 0, ...plain });
    const p2027 = supplyOf({ ...pellets, factorSet: "gmodg2027" }, energy);
    expect(p2027.primaryEnergy).toBeCloseTo(10_000 * 0.7 + 250 * 1.5);
    expect(supplyOf(pellets, energy).primaryEnergy).toBeCloseTo(10_000 * 0.2 + 250 * 1.8);
  });

  it("takes the building's own prices and CO2 price over the defaults", () => {
    const s = supplyOf(
      withHeating(
        { carrier: "gas", efficiency: 1, hotWater: 0, ...plain },
        { prices: { gas: 0.09, electric: 0.3 }, co2Price: 100 },
      ),
      energy,
    );
    // The own gas price holds the CO2 price at 60 €/t: 40 €/t more on 0.182 kg per kWh.
    expect(s.cost).toBeCloseTo(10_000 * (0.09 + (0.182 * 40 * 1.19) / 1000) + 150 * 0.3);
    expect(s.co2Cost).toBeCloseTo((10_000 * 0.182 * 100 * 1.19) / 1000);
  });

  it("has the landlord pay a share of the CO2 cost only when the building is rented", () => {
    const oil = {
      carrier: "oil" as const,
      efficiency: 0.8,
      hotWater: 12.5,
      hotWaterEfficiency: 0.8,
      ...plain,
    };
    const house = withHeating(oil, { ownerOccupied: false });
    const rented = supplyOf({ ...house, livingArea: 100 }, energy);
    // 14,062.5 kWh x 0.266 / 100 m² living area = 37.4 kg/m²a: the 37 to 42 step, landlord 60 %.
    expect(rented.billedCo2PerM2).toBeCloseTo(37.4, 1);
    expect(rented.landlordShare).toBe(0.6);
    // The law counts per m² of living area, not A_N: without one entered it is A_N / 1.2.
    const guessed = supplyOf(house, energy);
    expect(guessed.billedCo2PerM2).toBeCloseTo(44.9, 1);
    expect(guessed.landlordShare).toBe(0.7);
    const own = supplyOf(withHeating(oil), energy);
    expect(own.landlordShare).toBe(0);
  });

  it("uses a gas boiler when no heating system is entered, with pipe losses and a hotter hot water", () => {
    resetIds();
    const s = supplyOf(exampleHouse("en"), energy);
    expect(s.heating.carrier).toBe("gas");
    // 10 % distribution loss; hot water at 0.85 against 0.92 for heating.
    expect(s.endParts.heating).toBeCloseTo((10_000 * 1.1) / CARRIERS.gas.efficiency);
    expect(s.endParts.hotWater).toBeCloseTo((1250 * 1.1) / CARRIERS.gas.hotWaterEfficiency);
  });
});

describe("landlordCo2Share (CO2KostAufG annex)", () => {
  it("follows the ten steps", () => {
    expect(landlordCo2Share(0)).toBe(0);
    expect(landlordCo2Share(11.99)).toBe(0);
    expect(landlordCo2Share(12)).toBe(0.1);
    expect(landlordCo2Share(31.9)).toBe(0.4);
    expect(landlordCo2Share(32)).toBe(0.5);
    expect(landlordCo2Share(51.99)).toBe(0.8);
    expect(landlordCo2Share(52)).toBe(0.95);
    expect(landlordCo2Share(200)).toBe(0.95);
  });
});
