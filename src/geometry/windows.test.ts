import { describe, expect, it } from "vitest";
import { PRESET_IDS } from "./constructions";
import { gOf } from "./energy";
import { GLAZING_G } from "./sun";
import { WINDOW_TYPES, windowConstruction, windowType } from "./windows";

describe("window types", () => {
  it("finds a type by id and nothing for an unknown id", () => {
    expect(windowType(PRESET_IDS.glazingTriple)?.uValue).toBe(0.8);
    expect(windowType("c_unknown")).toBeUndefined();
  });

  it("turns each type into a window construction with its U and g", () => {
    for (const type of WINDOW_TYPES) {
      const c = windowConstruction(type, "de");
      expect(c).toEqual({
        id: type.id,
        name: type.de,
        category: "window",
        uValue: type.uValue,
        gValue: type.g,
      });
    }
  });
});

describe("gOf", () => {
  const base = { name: "w", category: "window" as const, uValue: 1 };

  it("takes the construction's own g-value first", () => {
    expect(gOf({ ...base, id: PRESET_IDS.glazingTriple, gValue: 0.3 })).toBe(0.3);
  });

  it("falls back to the type's g, then to double glazing", () => {
    expect(gOf({ ...base, id: PRESET_IDS.glazingTriple })).toBe(0.5);
    expect(gOf({ ...base, id: "c_unknown" })).toBe(GLAZING_G);
    expect(gOf(undefined)).toBe(GLAZING_G);
  });
});
