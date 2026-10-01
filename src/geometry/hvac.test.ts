import { describe, expect, it } from "vitest";
import { DEFAULT_ASSIGNMENT, PRESET_IDS, defaultConstructions } from "./constructions";
import { computeEnergy } from "./energy";
import { rect } from "./fixtures";
import {
  heatPumpReadiness,
  radiatorOutputFactor,
  requiredFlowTemperature,
  roomEnvelopeLoss,
  roomHeatLoads,
  suggestHeatPumpPower,
  suggestRadiatorPower,
  validateRadiator,
} from "./hvac";
import { computeRooms } from "./rooms";
import { exampleAltbau } from "@/lib/examples";
import { resetIds } from "@/lib/ids";
import type { Building, Radiator, Segment } from "./types";

let n = 0;
const factory = { createId: () => `room_${++n}`, defaultName: (i: number) => `Room ${i}` };

function building(walls: Segment[] = [], radiators: Radiator[] = []): Building {
  return {
    id: "b",
    name: "b",
    footprint: rect,
    wallThickness: 0.3,
    zones: [],
    constructions: defaultConstructions("en"),
    ...DEFAULT_ASSIGNMENT,
    storeys: [
      {
        id: "s0",
        name: "G",
        height: 3,
        openings: [],
        interiorWalls: walls,
        rooms: computeRooms(rect, walls, [], factory),
        radiators,
      },
    ],
  };
}

describe("roomEnvelopeLoss and roomHeatLoads", () => {
  it("a single room owns the whole envelope; its load matches the building at 34 K", () => {
    const b = building();
    const e = computeEnergy(b);
    const room = b.storeys[0]!.rooms[0]!;
    expect(roomEnvelopeLoss(b, b.storeys[0]!, room)).toBeCloseTo(
      e.transmissionLoss - e.bridgeLoss,
      6,
    );
    const loads = roomHeatLoads(b);
    expect(loads).toHaveLength(1);
    expect(loads[0]!.load).toBeCloseTo((e.transmissionLoss + 0.34 * 0.5 * e.heatedVolume) * 34, 3);
    expect(loads[0]!.coverage).toBe(0);
  });

  it("two rooms split the envelope by their exterior walls and the loads sum to the total", () => {
    const b = building([{ a: { x: 4, y: 0 }, b: { x: 4, y: 8 } }]);
    const e = computeEnergy(b);
    const loads = roomHeatLoads(b);
    expect(loads).toHaveLength(2);
    const total = loads.reduce((s, r) => s + r.load, 0);
    expect(total).toBeCloseTo((e.transmissionLoss + 0.34 * 0.5 * e.heatedVolume) * 34, 3);
    const small = loads.find((r) => r.name.endsWith("1") || r.load < total / 2)!;
    expect(small.load).toBeLessThan(total / 2);
  });

  it("radiators count for the room behind their wall segment", () => {
    const rad: Radiator = { id: "r1", wallIndex: 0, offset: 1, width: 1, height: 0.6, power: 1500 };
    const b = building([{ a: { x: 4, y: 0 }, b: { x: 4, y: 8 } }], [rad]);
    const loads = roomHeatLoads(b);
    const left = loads.find((r) => r.installed === 1500)!;
    expect(left).toBeDefined();
    expect(left.coverage).toBeCloseTo(1500 / left.load);
  });

  it("suggests radiator and heat pump sizes", () => {
    expect(suggestRadiatorPower(1234)).toBe(1300);
    expect(suggestRadiatorPower(50)).toBe(300);
    const kw = suggestHeatPumpPower(building());
    const total = roomHeatLoads(building()).reduce((s, r) => s + r.load, 0);
    expect(kw).toBeGreaterThanOrEqual((total * 1.1) / 1000);
    expect(kw * 2).toBe(Math.round(kw * 2));
  });

  it("includes a heated attic in room ventilation loads", () => {
    const b = building();
    b.roof = {
      kind: "gable",
      pitch: 45,
      overhang: 0.8,
      ridgeAxis: "x",
      parapet: 0,
      heatedAttic: true,
    };
    const energy = computeEnergy(b);
    expect(energy.heatedVolume).toBeGreaterThan(80 * 3);
    const total = roomHeatLoads(b).reduce((sum, room) => sum + room.load, 0);
    expect(total).toBeCloseTo((energy.transmissionLoss + 0.34 * 0.5 * energy.heatedVolume) * 34, 3);
  });

  it("counts a wall on both halves of an edge split by a collinear vertex", () => {
    const plain = building();
    const split = [{ x: 0, y: 0 }, { x: 5, y: 0 }, ...rect.slice(1)];
    const b: Building = {
      ...plain,
      footprint: split,
      storeys: plain.storeys.map((s) => ({ ...s, rooms: computeRooms(split, [], [], factory) })),
    };
    const loss = (x: Building) => roomEnvelopeLoss(x, x.storeys[0]!, x.storeys[0]!.rooms[0]!);
    expect(loss(b)).toBeCloseTo(loss(plain), 6);
  });
});

describe("validateRadiator", () => {
  const storey = () => building().storeys[0]!;
  const rad = (patch: Partial<Radiator> = {}): Radiator => ({
    id: "r",
    wallIndex: 0,
    offset: 1,
    width: 1,
    height: 0.6,
    power: 800,
    ...patch,
  });

  it("stays on the wall", () => {
    expect(validateRadiator(rad(), storey(), 10)).toBe(true);
    expect(validateRadiator(rad({ offset: 9.5 }), storey(), 10)).toBe(false);
    expect(validateRadiator(rad({ offset: -0.1 }), storey(), 10)).toBe(false);
  });

  it("may sit under a window but not across a door", () => {
    const s = storey();
    s.openings = [
      {
        id: "w",
        wallIndex: 0,
        kind: "window",
        offset: 1,
        width: 1.2,
        height: 1.4,
        sill: 0.9,
        constructionId: PRESET_IDS.glazingDouble,
      },
      {
        id: "d",
        wallIndex: 0,
        kind: "door",
        offset: 5,
        width: 1,
        height: 2.1,
        sill: 0,
        constructionId: PRESET_IDS.doorOld,
      },
    ];
    expect(validateRadiator(rad({ offset: 1.1, width: 1 }), s, 10)).toBe(true);
    expect(validateRadiator(rad({ offset: 4.8, width: 1 }), s, 10)).toBe(false);
  });

  it("does not overlap another radiator", () => {
    const s = storey();
    s.radiators = [rad({ id: "other", offset: 1.5 })];
    expect(validateRadiator(rad({ offset: 1 }), s, 10)).toBe(false);
    expect(validateRadiator(rad({ offset: 3 }), s, 10)).toBe(true);
  });
});

describe("heat pump readiness (flow temperature test)", () => {
  it("gives the rated output at 75 °C and about half at 55 °C, by EN 442", () => {
    expect(radiatorOutputFactor(75)).toBeCloseTo(1, 6);
    // (29.72 / 49.83)^1.3 = 0.511
    expect(radiatorOutputFactor(55)).toBeCloseTo(0.511, 3);
    expect(radiatorOutputFactor(30)).toBe(0);
    // A cooler room gets more from the same water.
    expect(radiatorOutputFactor(55, 15)).toBeGreaterThan(radiatorOutputFactor(55, 20));
  });

  it("finds the lowest flow temperature that covers the room", () => {
    // Twice the load installed: covered at about the temperature where the factor is 0.5.
    const flow = requiredFlowTemperature(1000, 2000);
    expect(flow).not.toBeNull();
    expect(radiatorOutputFactor(flow ?? 0) * 2000).toBeGreaterThanOrEqual(1000);
    expect(radiatorOutputFactor((flow ?? 0) - 0.2) * 2000).toBeLessThan(1000);
    expect(flow).toBeLessThan(56);
    expect(requiredFlowTemperature(1000, 1000)).toBeCloseTo(75, 0);
    expect(requiredFlowTemperature(1000, 0)).toBeNull();
    expect(requiredFlowTemperature(1000, 300)).toBeNull();
  });

  it("judges the demo Altbau: its radiators decide the flow temperature", () => {
    resetIds();
    const b = exampleAltbau("en");
    const r = heatPumpReadiness(b);
    expect(r.rooms.length).toBeGreaterThan(0);
    const worst = Math.max(...r.rooms.map((x) => x.flow ?? 99));
    expect(r.flow ?? 99).toBe(worst);
    expect(r.ready).toBe(r.rooms.filter((x) => x.flow !== null && x.flow <= 55).length);
    // Doubling every radiator can only lower the flow temperature.
    const bigger = {
      ...b,
      storeys: b.storeys.map((s) => ({
        ...s,
        radiators: s.radiators?.map((rad) => ({ ...rad, power: rad.power * 2 })),
      })),
    };
    const after = heatPumpReadiness(bigger);
    expect(after.ready).toBeGreaterThanOrEqual(r.ready);
  });
});
