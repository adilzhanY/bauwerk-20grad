import { describe, expect, it } from "vitest";
import { PSI, extractBridges, summarizeBridges } from "./bridges";
import { DEFAULT_ASSIGNMENT, PRESET_IDS, defaultConstructions } from "./constructions";
import { rect } from "./fixtures";
import type { Building, Opening } from "./types";

function building(
  storeys = 1,
  openings: Opening[] = [],
  interiorWalls: Building["storeys"][number]["interiorWalls"] = [],
): Building {
  return {
    id: "b",
    name: "b",
    footprint: rect,
    wallThickness: 0.3,
    zones: [],
    constructions: defaultConstructions("en"),
    ...DEFAULT_ASSIGNMENT,
    storeys: Array.from({ length: storeys }, (_, i) => ({
      id: `s${i}`,
      name: `S${i}`,
      height: 3,
      openings: i === 0 ? openings : [],
      interiorWalls: i === 0 ? interiorWalls : [],
      rooms: [],
    })),
  };
}

const win: Opening = {
  id: "w",
  wallIndex: 0,
  kind: "window",
  offset: 2,
  width: 1.2,
  height: 1.4,
  sill: 0.9,
  constructionId: PRESET_IDS.glazingDouble,
};

describe("extractBridges", () => {
  it("the default rectangle has four corners of 3 m, a slab edge and a roof edge of 36 m", () => {
    const s = summarizeBridges(building(), "poor");
    expect(s.lengths.corner).toBe(12);
    expect(s.lengths.slabEdge).toBe(36);
    expect(s.lengths.roofEdge).toBe(36);
    expect(s.lengths.floorJoint).toBe(0);
    expect(s.lengths.opening).toBe(0);
    expect(s.total).toBeCloseTo(12 * 0.15 + 36 * 0.5 + 36 * 0.3);
  });

  it("each window adds exactly 2(w + h) and an invalid one adds nothing", () => {
    const s = summarizeBridges(building(1, [win]), "good");
    expect(s.lengths.opening).toBeCloseTo(2 * (1.2 + 1.4));
    expect(s.losses.opening).toBeCloseTo(PSI.good.opening * 5.2);
    const bad = summarizeBridges(building(1, [{ ...win, offset: 9.5 }]), "good");
    expect(bad.lengths.opening).toBe(0);
    const b = extractBridges(building(1, [win])).find((x) => x.type === "opening")!;
    expect(b.segments).toHaveLength(4);
    expect(b.segments[0]?.z0).toBe(0.9);
    expect(b.segments[1]?.z0).toBe(2.3);
  });

  it("two storeys add one intermediate floor joint and eight corners", () => {
    const s = summarizeBridges(building(2), "good");
    expect(s.lengths.floorJoint).toBe(36);
    expect(s.lengths.slabEdge).toBe(36);
    expect(s.lengths.roofEdge).toBe(36);
    expect(s.lengths.corner).toBe(24);
    const roof = extractBridges(building(2)).find((x) => x.type === "roofEdge")!;
    expect(roof.segments[0]?.z0).toBe(6);
  });

  it("a fully unheated storey has no bridges; the envelope closes under it", () => {
    const b = building(2);
    b.zones = [{ id: "cold", name: "Attic", color: "#ccc", heated: false, temperature: 5 }];
    b.storeys[1]!.rooms = [{ id: "r", name: "r", polygon: rect, area: 80, zoneId: "cold" }];
    const s = summarizeBridges(b, "good");
    expect(s.bridges.some((x) => x.storeyId === "s1")).toBe(false);
    expect(s.lengths.corner).toBe(12);
    expect(s.lengths.floorJoint).toBe(0);
    const roof = s.bridges.find((x) => x.type === "roofEdge")!;
    expect(roof.segments[0]?.z0).toBe(3);
  });

  it("an interior wall touching two exterior walls adds two junctions, a floating one none", () => {
    const s = summarizeBridges(building(1, [], [{ a: { x: 4, y: 0 }, b: { x: 4, y: 8 } }]), "good");
    expect(s.lengths.junction).toBe(6);
    const f = summarizeBridges(building(1, [], [{ a: { x: 3, y: 3 }, b: { x: 6, y: 3 } }]), "good");
    expect(f.lengths.junction).toBe(0);
  });

  it("good detailing loses far less than poor", () => {
    const b = building(2, [win], [{ a: { x: 4, y: 0 }, b: { x: 4, y: 8 } }]);
    expect(summarizeBridges(b, "good").total).toBeLessThan(summarizeBridges(b, "poor").total / 2);
  });
});
