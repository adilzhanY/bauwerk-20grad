import { describe, expect, it } from "vitest";
import { de } from "./de";
import { en } from "./en";
import { defaultRoomName, defaultStoreyName, translate } from "./index";

describe("messages", () => {
  it("German has every English key and no empty strings", () => {
    const enKeys = Object.keys(en).sort();
    const deKeys = Object.keys(de).sort();
    expect(deKeys).toEqual(enKeys);
    for (const v of Object.values(de)) expect(v.trim()).not.toBe("");
    for (const v of Object.values(en)) expect(v.trim()).not.toBe("");
  });

  it("contains no dashes used as punctuation", () => {
    const all = [...Object.values(en), ...Object.values(de)].join("\n");
    expect(all).not.toMatch(/[\u2013\u2014]/);
  });

  it("fills placeholders", () => {
    expect(translate("en", "wall.title", { n: 3, storey: "Ground floor" })).toBe(
      "Exterior wall 3, Ground floor",
    );
    expect(translate("de", "zone.defaultName", { n: 1 })).toBe("Zone 1");
  });

  it("names storeys and rooms in both languages", () => {
    expect([0, 1, 2, 3, 11].map((i) => defaultStoreyName(i, "en"))).toEqual([
      "Ground floor",
      "1st floor",
      "2nd floor",
      "3rd floor",
      "11th floor",
    ]);
    expect([0, 1, 2].map((i) => defaultStoreyName(i, "de"))).toEqual([
      "Erdgeschoss",
      "1. Obergeschoss",
      "2. Obergeschoss",
    ]);
    expect(defaultRoomName(2, "de")).toBe("Raum 2");
  });
});
