import { describe, expect, it } from "vitest";
import { sourceRows, sourceStatus, sourceValue } from "./sources";
import type { Building } from "./types";
import { buildingFromBox } from "./box";

function surveyed(): Building {
  let n = 0;
  const b = buildingFromBox(
    {
      name: "Test",
      width: 10,
      depth: 8,
      storeys: 2,
      storeyHeight: 3,
      roof: "flat",
      era: "pre1918",
      centre: { x: 0, y: 0 },
    },
    "de",
    (prefix) => `${prefix}-${n++}`,
  );
  const opening = {
    id: "w5-o0",
    wallIndex: 0,
    kind: "window" as const,
    offset: 1,
    width: 1.2,
    height: 1.5,
    sill: 0.9,
    constructionId: b.windowConstructionId,
  };
  b.storeys[0]!.openings = [opening];
  b.sources = {
    storeys: { kind: "photo", photo: "BOo.jpg", value: [3, 3] },
    "opening:w5-o0": {
      kind: "photo",
      note: "automatisch erkannt",
      value: [0, "window", 1, 1.2, 1.5, 0.9],
    },
  };
  return b;
}

describe("value sources", () => {
  it("holds while the value is unchanged", () => {
    const b = surveyed();
    expect(sourceStatus(b, "storeys")).toMatchObject({ edited: false, gone: false });
    expect(sourceStatus(b, "opening:w5-o0")?.edited).toBe(false);
  });

  it("marks a value edited once it differs, and gone once it is deleted", () => {
    const b = surveyed();
    b.storeys[0]!.height = 3.2;
    b.storeys[0]!.openings[0]!.width = 1.4;
    expect(sourceStatus(b, "storeys")?.edited).toBe(true);
    expect(sourceStatus(b, "opening:w5-o0")?.edited).toBe(true);
    b.storeys[0]!.openings = [];
    expect(sourceStatus(b, "opening:w5-o0")).toMatchObject({ edited: true, gone: true });
  });

  it("does not count rounding below a tenth of a millimetre as an edit", () => {
    const b = surveyed();
    b.storeys[0]!.openings[0]!.offset = 1.00001;
    expect(sourceStatus(b, "opening:w5-o0")?.edited).toBe(false);
  });

  it("gives the canonical values the file writer uses", () => {
    const b = surveyed();
    expect(sourceValue(b, "storeys")).toEqual([3, 3]);
    expect(sourceValue(b, "opening:w5-o0")).toEqual([0, "window", 1, 1.2, 1.5, 0.9]);
    expect(sourceValue(b, "unknown")).toBeNull();
    expect(sourceRows(b).map((r) => r.path)).toEqual(["storeys", "opening:w5-o0"]);
  });
});
