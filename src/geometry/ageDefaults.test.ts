import { describe, expect, it } from "vitest";
import { AGE_IDS, ageClass, ageConstructions, wallKindFits } from "./ageDefaults";

const u = (list: ReturnType<typeof ageConstructions>, id: string) =>
  list.find((c) => c.id === id)?.uValue;

describe("default U-values by building age (BAnz AT 04.12.2020 B1)", () => {
  it("sorts a year into the nine age classes", () => {
    expect(ageClass(1905)).toBe(0);
    expect(ageClass(1918)).toBe(0);
    expect(ageClass(1919)).toBe(1);
    expect(ageClass(1975)).toBe(4);
    expect(ageClass(1995)).toBe(7);
    expect(ageClass(2010)).toBe(8);
  });

  it("gives a 1905 house with a thin solid brick wall and wooden single glazing the table values", () => {
    const list = ageConstructions(
      { year: 1905, wall: "brickSolidThin", window: "woodSingle", roofIsEnvelope: false },
      "de",
    );
    expect(u(list, AGE_IDS.wall)).toBe(2.8);
    // Cold attic: the timber beam ceiling, not the roof.
    expect(u(list, AGE_IDS.roof)).toBe(1.0);
    expect(u(list, AGE_IDS.floor)).toBe(1.6);
    expect(u(list, AGE_IDS.window)).toBe(5.0);
    expect(list.find((c) => c.id === AGE_IDS.window)?.gValue).toBe(0.87);
    expect(u(list, AGE_IDS.door)).toBe(2.9);
  });

  it("follows the age for a hollow brick house of 1975 with a heated attic and plastic windows", () => {
    const list = ageConstructions(
      { year: 1975, wall: "brickHollow", window: "plastic", roofIsEnvelope: true },
      "en",
    );
    expect(u(list, AGE_IDS.wall)).toBe(1.0);
    expect(u(list, AGE_IDS.roof)).toBe(0.8);
    expect(u(list, AGE_IDS.window)).toBe(3.0);
    expect(wallKindFits("brickSolidThin", 1975)).toBe(false);
  });
});
