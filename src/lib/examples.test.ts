import { describe, expect, it } from "vitest";
import { validateBuilding } from "@/geometry/export";
import { computeEnergy } from "@/geometry/energy";
import { applyScenario, fullEnvelopeScenario } from "@/geometry/scenarios";
import { exampleAltbau, exampleBlock, exampleHouse, exampleTower } from "./examples";

describe("example buildings", () => {
  it("all four validate in both languages", () => {
    for (const lang of ["en", "de"] as const) {
      expect(validateBuilding(exampleHouse(lang))).toBeNull();
      expect(validateBuilding(exampleBlock(lang))).toBeNull();
      expect(validateBuilding(exampleAltbau(lang))).toBeNull();
      expect(validateBuilding(exampleTower(lang))).toBeNull();
    }
  });

  it("the large tower has eighteen detailed storeys and more than fifteen thousand square metres", () => {
    const building = exampleTower("en");
    expect(building.name).toBe("Berlin office tower, 18 storeys");
    expect(building.storeys).toHaveLength(18);
    expect(building.storeys.every((storey) => storey.rooms.length === 9)).toBe(true);
    expect(building.storeys.reduce((sum, storey) => sum + storey.rooms.length, 0)).toBe(162);
    expect(building.storeys.reduce((sum, storey) => sum + storey.openings.length, 0)).toBe(719);
    expect(
      building.storeys.reduce(
        (total, storey) => total + storey.rooms.reduce((sum, room) => sum + room.area, 0),
        0,
      ),
    ).toBeCloseTo(15_552, 4);
    expect(building.storeys[17]?.name).toBe("17th floor");
    expect(building.storeys[17]?.rooms.map((room) => room.name)).toContain("Office 18.8");
    const energy = computeEnergy(building);
    expect(energy.heatedFloorArea).toBeCloseTo(15_552, 4);
    expect(energy.heatingDemand).toBeGreaterThan(0);
  });

  it("the demo Altbau has named rooms, interior doors, radiators, a map position and scenarios", () => {
    const b = exampleAltbau("en");
    expect(b.storeys).toHaveLength(3);
    expect(b.storeys[0]?.rooms.map((r) => r.name).sort()).toEqual(
      ["Flat left", "Flat right", "Shop", "Stairwell"].sort(),
    );
    expect(b.storeys[1]?.rooms.map((r) => r.name)).toContain("Bedroom left");
    expect(b.storeys.every((s) => s.openings.some((o) => o.interior && o.kind === "door"))).toBe(
      true,
    );
    expect(b.storeys.every((s) => (s.radiators?.length ?? 0) > 0)).toBe(true);
    expect(b.origin?.lat).toBeCloseTo(52.4993);
    expect(b.scenarios).toHaveLength(2);
    expect(b.roof?.kind).toBe("gable");
    const e = computeEnergy(b);
    // The class is read off the end energy, as on an Energieausweis: a heating demand of
    // about 237 kWh/(m²a) plus hot water through a gas boiler (0.92) is about 271, class H.
    expect(e.energyClass).toBe("H");
    expect(
      computeEnergy(applyScenario(b, fullEnvelopeScenario(b))).specificHeatingDemand,
    ).toBeLessThan(80);
  });
});
