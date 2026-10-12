import { describe, expect, it } from "vitest";
import { DEFAULT_ASSIGNMENT, PRESET_IDS, defaultConstructions } from "./constructions";
import { GEG_MAX_U, checkConstruction, gegChecks, gegPassCount } from "./geg";
import { rect } from "./fixtures";
import type { Building } from "./types";

const building = (): Building => ({
  id: "b",
  name: "b",
  footprint: rect,
  wallThickness: 0.3,
  storeys: [],
  zones: [],
  constructions: defaultConstructions("en"),
  ...DEFAULT_ASSIGNMENT,
});

describe("GEG check", () => {
  it("the uninsulated stock fails every element, the insulated presets pass", () => {
    const stock = gegChecks(building());
    expect(stock.map((c) => c.category)).toEqual(["wall", "roof", "floor", "window", "door"]);
    expect(gegPassCount(stock)).toBe(0);
    const renovated = gegChecks({
      ...building(),
      wallConstructionId: PRESET_IDS.wallInsulated,
      roofConstructionId: PRESET_IDS.roofInsulated,
      floorConstructionId: PRESET_IDS.floorInsulated,
      windowConstructionId: PRESET_IDS.glazingTriple,
      doorConstructionId: PRESET_IDS.doorInsulated,
    });
    expect(gegPassCount(renovated)).toBe(5);
    expect(renovated[0]?.ratio).toBeLessThan(1);
  });

  it("a value exactly on the limit passes, a missing construction fails", () => {
    const c = {
      id: "x",
      name: "x",
      category: "window" as const,
      uValue: GEG_MAX_U.window,
    };
    expect(checkConstruction(c, "window").ok).toBe(true);
    expect(checkConstruction(undefined, "wall").ok).toBe(false);
  });

  it("a flat roof is held to 0.20, a pitched roof to 0.24", () => {
    const roof = { id: "r", name: "r", category: "roof" as const, uValue: 0.22 };
    const withRoof = (kind: "flat" | "gable"): Building => ({
      ...building(),
      constructions: [...defaultConstructions("en"), roof],
      roofConstructionId: "r",
      roof: { kind, pitch: 35, overhang: 0.3, ridgeAxis: "x", parapet: 0.3, heatedAttic: false },
    });
    const flat = gegChecks(withRoof("flat"))[1];
    expect(flat?.limit).toBe(0.2);
    expect(flat?.ok).toBe(false);
    expect(gegChecks(withRoof("gable"))[1]?.ok).toBe(true);
  });
});
