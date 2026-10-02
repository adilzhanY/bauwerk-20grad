import { describe, expect, it } from "vitest";
import { exampleAltbau, exampleTower } from "@/lib/examples";
import { localizeBuilding } from "./localizeBuilding";

describe("localizeBuilding", () => {
  it("translates all known model names in the Kreuzberg example", () => {
    const german = localizeBuilding(exampleAltbau("en"), "de");
    expect(german.name).toBe("Altbau Kreuzberg, Baujahr 1905");
    expect(german.storeys.map((storey) => storey.name)).toEqual([
      "Erdgeschoss",
      "1. Obergeschoss",
      "2. Obergeschoss",
    ]);
    expect(german.storeys.flatMap((storey) => storey.rooms.map((room) => room.name))).toContain(
      "Ladenlokal",
    );
    expect(german.zones.map((zone) => zone.name)).toEqual(["Wohnen", "Laden", "Treppenhaus"]);
    expect(german.scenarios?.map((scenario) => scenario.name)).toEqual([
      "Fenster und Dach",
      "Fassade dämmen",
    ]);
    expect(german.constructions.map((construction) => construction.name)).toContain(
      "Ziegelwand, ungedämmt",
    );
    expect(
      german.constructions.flatMap((construction) =>
        (construction.layers ?? []).map((layer) => layer.name),
      ),
    ).toContain("Vollziegel");
  });

  it("round trips known names and preserves custom names", () => {
    const source = exampleAltbau("en");
    source.name = "Haus Müller";
    if (source.storeys[2]) source.storeys[2].name = "Dachatelier";
    if (source.storeys[1]?.rooms[0]) source.storeys[1].rooms[0].name = "Musikzimmer";
    if (source.zones[0]) source.zones[0].name = "Privat";
    if (source.constructions[1]) {
      source.constructions[1].name = "Eigene Wand";
      if (source.constructions[1].layers?.[0]) {
        source.constructions[1].layers[0].name = "Eigener Putz";
      }
    }
    if (source.scenarios?.[1]) source.scenarios[1].name = "Mein Paket";
    const german = localizeBuilding(source, "de");
    const english = localizeBuilding(german, "en");
    expect(english.name).toBe("Haus Müller");
    expect(english.storeys[0]?.name).toBe("Ground floor");
    expect(english.storeys[2]?.name).toBe("Dachatelier");
    expect(english.storeys[0]?.rooms.some((room) => room.name === "Shop")).toBe(true);
    expect(english.storeys[1]?.rooms[0]?.name).toBe("Musikzimmer");
    expect(english.zones[0]?.name).toBe("Privat");
    expect(english.constructions[1]?.name).toBe("Eigene Wand");
    expect(english.constructions[1]?.layers?.[0]?.name).toBe("Eigener Putz");
    expect(english.scenarios?.[1]?.name).toBe("Mein Paket");
    expect(english.constructions.map((construction) => construction.name)).toContain(
      "Brick wall, uninsulated",
    );
    expect(
      english.constructions.flatMap((construction) =>
        (construction.layers ?? []).map((layer) => layer.name),
      ),
    ).toContain("Solid brick");
  });

  it("translates the generated tower names", () => {
    const german = localizeBuilding(exampleTower("en"), "de");
    expect(german.name).toBe("Berliner Bürohochhaus, 18 Geschosse");
    expect(german.storeys[17]?.name).toBe("17. Obergeschoss");
    expect(german.storeys[17]?.rooms.map((room) => room.name)).toContain("Büro 18.8");
    expect(german.storeys[17]?.rooms.map((room) => room.name)).toContain("Kern 18");
    expect(german.zones.map((zone) => zone.name)).toEqual(["Büros", "Kernbereich"]);
  });
});
