import { describe, expect, it } from "vitest";
import { levelFromText, storeysForPages } from "./storeyFromText";

describe("levelFromText", () => {
  it("reads German and English storey names", () => {
    expect(levelFromText("GRUNDRISS DES ERDGESCHOSSES v. HAUS MÜLLER")).toBe(0);
    expect(levelFromText("Grundriss EG  M 1:100")).toBe(0);
    expect(levelFromText("1. Obergeschoss")).toBe(1);
    expect(levelFromText("Grundriss 2.OG")).toBe(2);
    expect(levelFromText("OG 3")).toBe(3);
    expect(levelFromText("Ground floor plan")).toBe(0);
    expect(levelFromText("2nd floor")).toBe(2);
    expect(levelFromText("Dachgeschoss")).toBe("top");
    expect(levelFromText("Kellergeschoss")).toBe(-1);
    expect(levelFromText("Obergeschoss")).toBe(1);
  });

  it("does not read abbreviations inside words or text without a storey", () => {
    expect(levelFromText("Weg zum Garten, Steg")).toBeNull();
    expect(levelFromText("Maßstab 1:100, Treppe")).toBeNull();
    expect(levelFromText("")).toBeNull();
  });
});

describe("storeysForPages", () => {
  const storeys = ["eg", "og1", "og2", "dg"];

  it("puts named pages on their storey, whatever the page order", () => {
    expect(storeysForPages(["Dachgeschoss", "2. OG", "Erdgeschoss", "1. OG"], storeys)).toEqual([
      "dg",
      "og2",
      "eg",
      "og1",
    ]);
  });

  it("gives pages without a name the free storeys from the bottom up", () => {
    expect(storeysForPages(["", "1. OG", "", ""], storeys)).toEqual(["eg", "og1", "og2", "dg"]);
    expect(storeysForPages(["scan", "scan"], storeys)).toEqual(["eg", "og1"]);
  });

  it("leaves out a basement, a second page for a taken storey and pages beyond the storeys", () => {
    expect(storeysForPages(["Keller", "EG", "EG", ""], ["eg", "og1"])).toEqual([
      null,
      "eg",
      null,
      "og1",
    ]);
    expect(storeysForPages(["", "", ""], ["eg"])).toEqual(["eg", null, null]);
  });
});
