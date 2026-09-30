import { describe, expect, it } from "vitest";
import { DEFAULT_ASSIGNMENT, PRESET_IDS, defaultConstructions } from "./constructions";
import { computeEnergy, energyClass, orientationOf } from "./energy";
import { applyScenario, fullEnvelopeScenario } from "./scenarios";
import { lShape, rect } from "./fixtures";
import { edges, pointInPolygon } from "./polygon";
import { computeRooms } from "./rooms";
import type { Building, Opening, Segment } from "./types";

const presets = defaultConstructions("en");
const U = (id: string) => presets.find((c) => c.id === id)!.uValue;
const WALL = U(PRESET_IDS.wallBrick);
const FLOOR = U(PRESET_IDS.floorBare);
const ROOF = U(PRESET_IDS.roofBare);
/** The dividing wall: the default partition, 24 m² of it, at F_x 0.5 to the unheated room. */
const PARTITION = 0.5 * U(PRESET_IDS.interiorPartition) * 24;
/** Uninsulated default: walls 36 m x 3 m = 108 m², floor 80 m² with F_x 0.6, roof 80 m². */
const BASE = WALL * 108 + 0.6 * FLOOR * 80 + ROOF * 80;
/** A_N of the 10 x 8 x 3 m storey: 0.32 x V_e = 0.32 x 240. */
const A_N = 76.8;
/** Usable internal gains on A_N. */
const INTERNAL = 0.95 * 22 * A_N;
/** H_V: 0.34 x n 0.7 x 0.76 V_e (one storey). */
const VENTILATION = 0.34 * 0.7 * 0.76 * 240;

let n = 0;
const factory = { createId: () => `room_${++n}`, defaultName: (i: number) => `Room ${i}` };

function building(
  interiorWalls: Segment[] = [],
  openings: Opening[] = [],
  zones: Building["zones"] = [],
  roomZones: Record<number, string> = {},
): Building {
  const rooms = computeRooms(rect, interiorWalls, [], factory).map((r, i) =>
    roomZones[i] === undefined ? r : { ...r, zoneId: roomZones[i] },
  );
  return {
    id: "b",
    name: "Test",
    footprint: rect,
    wallThickness: 0.3,
    zones,
    constructions: defaultConstructions("en"),
    ...DEFAULT_ASSIGNMENT,
    storeys: [{ id: "s0", name: "Ground floor", height: 3, openings, interiorWalls, rooms }],
  };
}

const window = (patch: Partial<Opening> = {}): Opening => ({
  id: "w",
  wallIndex: 0,
  kind: "window",
  offset: 2,
  width: 1.2,
  height: 1.4,
  sill: 0.9,
  constructionId: PRESET_IDS.glazingDouble,
  ...patch,
});

describe("computeEnergy on the default 10 by 8 single storey", () => {
  // Envelope: walls 36 m x 3 m = 108 m², floor 80 m², roof 80 m², U from the preset layer stacks.
  it("hand-computed transmission loss, ventilation loss and heating demand", () => {
    const e = computeEnergy(building());
    expect(e.envelopeArea).toBeCloseTo(268);
    expect(e.wallNetArea).toBeCloseTo(108);
    expect(e.transmissionLoss - e.bridgeLoss).toBeCloseTo(BASE);
    expect(e.specificTransmissionLoss).toBeCloseTo(e.transmissionLoss / 268);
    expect(e.heatedVolume).toBeCloseTo(240);
    expect(e.heatedFloorArea).toBeCloseTo(80);
    expect(e.referenceArea).toBeCloseTo(A_N);
    // The flat thermal bridge surcharge: 0.10 W/(m²K) over the 268 m² envelope.
    expect(e.bridgeMethod).toBe("flat");
    expect(e.bridgeLoss).toBeCloseTo(26.8);
    expect(e.ventilationLoss).toBeCloseTo(VENTILATION);
    expect(e.internalGains).toBeCloseTo(INTERNAL);
    expect(e.heatingDemand).toBeCloseTo((BASE + 26.8 + VENTILATION) * 66 - INTERNAL);
    expect(e.specificHeatingDemand).toBeCloseTo(
      ((BASE + 26.8 + VENTILATION) * 66 - INTERNAL) / A_N,
    );
    expect(e.energyClass).toBe("H");
  });

  it("the full envelope variant swaps every construction for the best in its category", () => {
    const b = building();
    const e = computeEnergy(applyScenario(b, fullEnvelopeScenario(b)));
    const best =
      U(PRESET_IDS.wallInsulated) * 108 +
      0.6 * U(PRESET_IDS.floorInsulated) * 80 +
      U(PRESET_IDS.roofInsulated) * 80;
    expect(e.transmissionLoss - e.bridgeLoss).toBeCloseTo(best);
    expect(e.transmissionLoss).toBeLessThan(BASE / 3);
    expect(e.energyClass).not.toBe("H");
  });

  it("a window replaces wall area and swapping its glazing changes H_T by U difference times area", () => {
    const withDouble = computeEnergy(building([], [window()]));
    const area = 1.2 * 1.4;
    expect(withDouble.windowArea).toBeCloseTo(area);
    expect(withDouble.wallNetArea).toBeCloseTo(108 - area);
    expect(withDouble.transmissionLoss - withDouble.bridgeLoss).toBeCloseTo(
      WALL * (108 - area) + 2.8 * area + 0.6 * FLOOR * 80 + ROOF * 80,
    );
    const withTriple = computeEnergy(
      building([], [window({ constructionId: PRESET_IDS.glazingTriple })]),
    );
    expect(withDouble.transmissionLoss - withTriple.transmissionLoss).toBeCloseTo(
      (2.8 - 0.8) * area,
    );
  });

  it("an invalid opening is ignored", () => {
    const e = computeEnergy(building([], [window({ offset: 9.5 })]));
    expect(e.windowArea).toBe(0);
    expect(e.transmissionLoss - e.bridgeLoss).toBeCloseTo(BASE);
  });

  it("window-to-wall ratio per orientation, y is north", () => {
    // Wall 0 (bottom edge) faces south. Two windows there: 2 x 1.68 over 30 m² gross.
    const e = computeEnergy(
      building([], [window({ id: "a", offset: 1 }), window({ id: "b", offset: 5 })]),
    );
    const s0 = e.storeys[0]!;
    expect(s0.windowToWall.S.wall).toBeCloseTo(30);
    expect(s0.windowToWall.S.ratio).toBeCloseTo((2 * 1.68) / 30);
    expect(s0.windowToWall.N.ratio).toBe(0);
    expect(e.windowToWallRatio).toBeCloseTo((2 * 1.68) / 108);
  });

  it("unheated rooms contribute nothing and the dividing wall counts once", () => {
    const zones: Building["zones"] = [
      { id: "cold", name: "Unheated", color: "#000", heated: false, temperature: 10 },
    ];
    const split: Segment[] = [{ a: { x: 4, y: 0 }, b: { x: 4, y: 8 } }];
    // Rooms come out in face order; find the left one (x < 4) by area 32.
    n = 0;
    const rooms = computeRooms(rect, split, [], factory);
    const leftIndex = rooms.findIndex((r) => r.area === 32);
    const e = computeEnergy(building(split, [], zones, { [leftIndex]: "cold" }));
    // Heated part is 6 x 8: walls 6 + 8 + 6 = 20 m x 3 m = 60 m², floor 48 m² with F_x 0.6,
    // roof 48 m², interior wall 8 x 3 x 1.0 with F_x 0.5 = 12.
    const heatedBase = WALL * 60 + 0.6 * FLOOR * 48 + ROOF * 48 + PARTITION;
    expect(e.heatedFloorArea).toBeCloseTo(48);
    expect(e.transmissionLoss - e.bridgeLoss).toBeCloseTo(heatedBase);
    expect(e.elements.some((x) => x.category === "interiorWall")).toBe(true);

    const allCold = computeEnergy(building(split, [], zones, { 0: "cold", 1: "cold" }));
    expect(allCold.heated).toBe(false);
    expect(allCold.transmissionLoss).toBe(0);
    expect(allCold.bridgeLoss).toBe(0);
    expect(allCold.envelopeArea).toBe(0);
    expect(allCold.heatedVolume).toBe(0);
    expect(allCold.ventilationLoss).toBe(0);
    expect(allCold.solarGains).toBe(0);
    expect(allCold.internalGains).toBe(0);
    expect(allCold.heatingDemand).toBe(0);
  });

  it("a window in an unheated room does not count, a window in a heated room does", () => {
    const zones: Building["zones"] = [
      { id: "cold", name: "Unheated", color: "#000", heated: false, temperature: 10 },
    ];
    const split: Segment[] = [{ a: { x: 4, y: 0 }, b: { x: 4, y: 8 } }];
    n = 0;
    const rooms = computeRooms(rect, split, [], factory);
    const leftIndex = rooms.findIndex((r) => r.area === 32);
    const coldWindow = window({ offset: 1 }); // x from 1 to 2.2, left room
    const warmWindow = window({ offset: 6 }); // x from 6 to 7.2, right room
    const a = computeEnergy(building(split, [coldWindow], zones, { [leftIndex]: "cold" }));
    const b = computeEnergy(building(split, [warmWindow], zones, { [leftIndex]: "cold" }));
    const base = WALL * 60 + 0.6 * FLOOR * 48 + ROOF * 48 + PARTITION;
    expect(a.transmissionLoss - a.bridgeLoss).toBeCloseTo(base);
    expect(b.transmissionLoss - b.bridgeLoss).toBeCloseTo(base - WALL * 1.68 + 2.8 * 1.68);
    expect(a.solarGains).toBe(0);
  });

  it("splits crossing interior walls before measuring heated to cold boundaries", () => {
    const zones: Building["zones"] = [
      { id: "cold", name: "Unheated", color: "#000", heated: false, temperature: 10 },
    ];
    const walls: Segment[] = [
      { a: { x: 4, y: 0 }, b: { x: 4, y: 8 } },
      { a: { x: 0, y: 4 }, b: { x: 10, y: 4 } },
    ];
    const b = building(walls, [], zones);
    const cold = b.storeys[0]!.rooms.find((room) => pointInPolygon({ x: 2, y: 2 }, room.polygon));
    expect(cold).toBeDefined();
    cold!.zoneId = "cold";
    const e = computeEnergy(b);
    const partitions = e.elements.filter((element) => element.category === "interiorWall");
    expect(partitions.reduce((sum, element) => sum + element.area, 0)).toBeCloseTo(8 * 3);
    expect(partitions.reduce((sum, element) => sum + element.loss, 0)).toBeCloseTo(PARTITION);
  });

  it("uses only heated surfaces in the specific transmission denominator", () => {
    const zones: Building["zones"] = [
      { id: "cold", name: "Unheated", color: "#000", heated: false, temperature: 10 },
    ];
    const split: Segment[] = [{ a: { x: 4, y: 0 }, b: { x: 4, y: 8 } }];
    const rooms = computeRooms(rect, split, [], factory);
    const leftIndex = rooms.findIndex((room) => room.area === 32);
    const e = computeEnergy(building(split, [], zones, { [leftIndex]: "cold" }));
    expect(e.envelopeArea).toBeCloseTo(60 + 48 + 48);
    expect(e.specificTransmissionLoss).toBeCloseTo(e.transmissionLoss / e.envelopeArea);
  });

  it("per zone breakdown sums to the total", () => {
    const zones: Building["zones"] = [
      { id: "z1", name: "A", color: "#000", heated: true, temperature: 20 },
      { id: "z2", name: "B", color: "#000", heated: true, temperature: 20 },
    ];
    const split: Segment[] = [{ a: { x: 4, y: 0 }, b: { x: 4, y: 8 } }];
    const e = computeEnergy(building(split, [window({ offset: 1 })], zones, { 0: "z1", 1: "z2" }));
    const sum = e.zones.reduce((s, z) => s + z.transmissionLoss, 0);
    expect(sum).toBeCloseTo(e.transmissionLoss - e.bridgeLoss);
    expect(e.zones.reduce((s, z) => s + z.floorArea, 0)).toBeCloseTo(80);
  });
});

describe("orientation and energy class", () => {
  it("buckets the rectangle and L shape edges", () => {
    const r = edges(rect).map((e) => orientationOf(e.normal));
    expect(r).toEqual(["S", "E", "N", "W"]);
    const l = edges(lShape).map((e) => orientationOf(e.normal));
    expect(l).toEqual(["S", "E", "N", "E", "N", "W"]);
    expect(orientationOf({ x: 0, y: 1 }, 90)).toBe("E");
  });

  it("energy class boundaries", () => {
    expect(energyClass(30)).toBe("A+");
    expect(energyClass(30.01)).toBe("A");
    expect(energyClass(75)).toBe("B");
    expect(energyClass(100)).toBe("C");
    expect(energyClass(130)).toBe("D");
    expect(energyClass(160)).toBe("E");
    expect(energyClass(200)).toBe("F");
    expect(energyClass(250)).toBe("G");
    expect(energyClass(251)).toBe("H");
  });
});

describe("thermal bridges in the energy balance", () => {
  it("adds ΔU_WB over the envelope by default: 0.10, 0.05 with good detailing, or as entered", () => {
    const e = computeEnergy(building());
    expect(e.bridgeLoss).toBeCloseTo(0.1 * 268);
    expect(e.transmissionLoss).toBeCloseTo(BASE + e.bridgeLoss);
    expect(computeEnergy({ ...building(), bridgeDetail: "good" }).bridgeLoss).toBeCloseTo(
      0.05 * 268,
    );
    expect(computeEnergy({ ...building(), bridgeSurcharge: 0.15 }).bridgeLoss).toBeCloseTo(
      0.15 * 268,
    );
  });

  it("adds Σ ψ·l with the detailed method, poor by default and good when detailed well", () => {
    const e = computeEnergy({ ...building(), bridgeMethod: "detailed" });
    // 4 corners x 3 m x 0.15 + 36 m slab x 0.5 + 36 m roof x 0.3
    expect(e.bridgeLoss).toBeCloseTo(1.8 + 18 + 10.8);
    const good = computeEnergy({ ...building(), bridgeMethod: "detailed", bridgeDetail: "good" });
    expect(good.bridgeLoss).toBeCloseTo(12 * 0.05 + 36 * 0.1 + 36 * 0.1);
  });

  it("leaves a party wall without bridges in the detailed method", () => {
    const e = computeEnergy({ ...building(), bridgeMethod: "detailed", sharedEdges: [1] });
    // Edge 1 (8 m) is shared: its two corners stay (each meets an outer wall), the slab and
    // roof edges lose 8 m each.
    expect(e.bridgeLoss).toBeCloseTo(1.8 + 28 * 0.5 + 28 * 0.3);
  });
});

describe("roof shape in the energy balance", () => {
  it("under a cold attic the heat leaves through the top floor ceiling, at F_x 0.8", () => {
    const flat = computeEnergy(building());
    const gable = computeEnergy({
      ...building(),
      roof: { kind: "gable", pitch: 45, overhang: 0, ridgeAxis: "x" },
    });
    const ceiling = gable.elements.find((e) => e.category === "roof");
    expect(ceiling?.ceiling).toBe(true);
    expect(ceiling?.area).toBeCloseTo(80);
    expect(ceiling?.loss).toBeCloseTo(0.8 * ROOF * 80);
    expect(gable.heatedVolume).toBeCloseTo(flat.heatedVolume);
  });

  it("a heated attic makes the sloped roof the envelope and adds its volume", () => {
    const flat = computeEnergy(building());
    const gable = computeEnergy({
      ...building(),
      roof: { kind: "gable", pitch: 45, overhang: 0, ridgeAxis: "x", heatedAttic: true },
    });
    expect(gable.storeys[0]!.roofArea).toBeCloseTo(80 / Math.cos(Math.PI / 4));
    const roof = gable.elements.find((e) => e.category === "roof");
    expect(roof?.area).toBeCloseTo(80 / Math.cos(Math.PI / 4));
    expect(roof?.loss).toBeCloseTo(ROOF * (80 / Math.cos(Math.PI / 4)));
    expect(flat.elements.find((e) => e.category === "roof")?.loss).toBeCloseTo(ROOF * 80);
    const attic = computeEnergy({
      ...building(),
      roof: { kind: "gable", pitch: 45, overhang: 0, ridgeAxis: "x", heatedAttic: true },
    });
    expect(attic.heatedVolume).toBeCloseTo(240 + 0.5 * 8 * 4 * 10);
  });

  it("excludes roof overhang from thermal area and heated attic volume", () => {
    const without = computeEnergy({
      ...building(),
      roof: { kind: "gable", pitch: 40, overhang: 0, ridgeAxis: "x", heatedAttic: true },
    });
    const withOverhang = computeEnergy({
      ...building(),
      roof: { kind: "gable", pitch: 40, overhang: 2, ridgeAxis: "x", heatedAttic: true },
    });
    expect(withOverhang.storeys[0]?.roofArea).toBeCloseTo(without.storeys[0]!.roofArea);
    expect(withOverhang.heatedVolume).toBeCloseTo(without.heatedVolume);
    expect(withOverhang.transmissionLoss).toBeCloseTo(without.transmissionLoss);
  });
});

describe("solar gains", () => {
  it("a south window reduces the heating demand by its usable gains, never below zero", () => {
    const none = computeEnergy(building());
    expect(none.solarGains).toBe(0);
    const south = computeEnergy(building([], [window()])); // wall 0 faces south
    // Double glazing g 0.75, F_W 0.9, F_F 0.7, F_S 0.9, south 270, utilisation 0.95.
    expect(south.solarGains).toBeCloseTo(1.68 * 0.75 * 0.9 * 0.7 * 0.9 * 270 * 0.95);
    expect(south.heatingDemand).toBeCloseTo(
      (south.transmissionLoss + south.ventilationLoss) * 66 - south.solarGains - INTERNAL,
    );
    const north = computeEnergy(building([], [window({ wallIndex: 2, offset: 2 })]));
    expect(north.solarGains).toBeLessThan(south.solarGains);
  });
});

describe("what a plan edit does to the balance", () => {
  it("keeps the first window when a second is dropped over it", () => {
    const first = window();
    const over = window({ id: "w2", offset: 2.6 });
    const one = computeEnergy(building([], [first]));
    const both = computeEnergy(building([], [first, over]));
    expect(both.windowArea).toBeCloseTo(one.windowArea);
    expect(both.solarGains).toBeCloseTo(one.solarGains);
    // Moved clear, it counts.
    const clear = computeEnergy(building([], [first, window({ id: "w2", offset: 5 })]));
    expect(clear.windowArea).toBeCloseTo(2 * one.windowArea);
  });

  it("divides by A_N, which follows the storey height outside 2.5 to 3.0 m", () => {
    const low = computeEnergy(building());
    expect(low.referenceArea).toBeCloseTo(0.32 * 240);
    const tall = building();
    tall.storeys[0]!.height = 3.4;
    const e = computeEnergy(tall);
    expect(e.heatedVolume).toBeCloseTo(80 * 3.4);
    expect(e.referenceArea).toBeCloseTo((1 / 3.4 - 0.04) * 80 * 3.4);
    expect(e.specificHeatingDemand).toBeCloseTo(e.heatingDemand / e.referenceArea);
  });

  it("takes room areas from their outlines, not from a stored number", () => {
    const b = building();
    const stale = {
      ...b,
      storeys: b.storeys.map((s) => ({ ...s, rooms: s.rooms.map((r) => ({ ...r, area: 999 })) })),
    };
    expect(computeEnergy(stale).heatedFloorArea).toBeCloseTo(80);
  });

  it("lets each glazing bring its own g-value: triple glazing lets in less sun", () => {
    const double = computeEnergy(building([], [window()]));
    const triple = computeEnergy(
      building([], [window({ constructionId: PRESET_IDS.glazingTriple })]),
    );
    expect(triple.solarGains / double.solarGains).toBeCloseTo(0.5 / 0.75);
  });
});
