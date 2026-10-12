import { describe, expect, it } from "vitest";
import { DEFAULT_ASSIGNMENT, PRESET_IDS, defaultConstructions } from "./constructions";
import { computeEnergy } from "./energy";
import { fromJson, toJson, validateBuilding } from "./export";
import { rect } from "./fixtures";
import { computeRooms } from "./rooms";
import { evaluateAll } from "./scenarios";
import type { Building } from "./types";

function sample(): Building {
  let n = 0;
  const factory = { createId: () => `room_${++n}`, defaultName: (i: number) => `Room ${i}` };
  const walls = [{ a: { x: 4, y: 0 }, b: { x: 4, y: 8 } }];
  return {
    id: "b1",
    name: "Haus",
    footprint: rect,
    wallThickness: 0.3,
    zones: [{ id: "z1", name: "Heated", color: "#ff0000", heated: true, temperature: 20 }],
    constructions: defaultConstructions("en"),
    ...DEFAULT_ASSIGNMENT,
    storeys: [
      {
        id: "s1",
        name: "Ground floor",
        height: 3,
        openings: [
          {
            id: "o1",
            wallIndex: 0,
            kind: "door",
            offset: 1,
            width: 1,
            height: 2.1,
            sill: 0,
            constructionId: PRESET_IDS.doorOld,
          },
          {
            id: "o2",
            wallIndex: 0,
            kind: "window",
            offset: 3,
            width: 1.2,
            height: 1.4,
            sill: 0.9,
            constructionId: PRESET_IDS.glazingDouble,
          },
        ],
        interiorWalls: walls,
        rooms: computeRooms(rect, walls, [], factory).map((r, i) =>
          i === 0 ? { ...r, zoneId: "z1" } : r,
        ),
      },
      { id: "s2", name: "1st floor", height: 2.8, openings: [], interiorWalls: [], rooms: [] },
    ],
  };
}

describe("toJson and fromJson", () => {
  it("round trips to a deep equal building", () => {
    const b = sample();
    const text = toJson(b);
    const result = fromJson(text);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.building).toEqual(b);
  });

  it("writes a derived energy block that import ignores", () => {
    const text = toJson(sample());
    const raw = JSON.parse(text) as { derived: { energy: { transmissionLoss: number } } };
    expect(raw.derived.energy.transmissionLoss).toBeGreaterThan(0);
    const result = fromJson(text);
    expect(result.ok).toBe(true);
  });

  it("uses a dot as the decimal separator regardless of locale", () => {
    const text = toJson({ ...sample(), wallThickness: 0.25 });
    expect(text).toContain('"wallThickness": 0.25');
    expect(text).not.toContain("0,25");
  });

  it("rejects text that is not JSON or not a Bauwerk file", () => {
    expect(fromJson("{not json")).toEqual({ ok: false, error: { code: "invalidJson" } });
    expect(fromJson('{"hello":1}')).toEqual({ ok: false, error: { code: "notBauwerkFile" } });
    expect(fromJson('{"format":"bauwerk","version":99,"building":{}}')).toEqual({
      ok: false,
      error: { code: "unsupportedVersion" },
    });
  });

  it("reports the path of a structural problem", () => {
    const b = sample();
    const raw: unknown = JSON.parse(toJson(b));
    (
      raw as { building: { storeys: { openings: { width: unknown }[] }[] } }
    ).building.storeys[0]!.openings[1]!.width = "wide";
    const result = fromJson(JSON.stringify(raw));
    expect(result).toEqual({
      ok: false,
      error: { code: "invalidStructure", path: "building.storeys[0].openings[1].width" },
    });
  });

  it("recomputes stored room areas from their polygons", () => {
    const raw = JSON.parse(toJson(sample())) as {
      building: { storeys: { rooms: { area: number }[] }[] };
    };
    raw.building.storeys[0]!.rooms[0]!.area = 999;
    const result = fromJson(JSON.stringify(raw));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.building.storeys[0]?.rooms[0]?.area).toBe(32);
  });

  it("imports a scenario roof or ΔU_WB from an older file and ignores it", () => {
    const raw = JSON.parse(toJson(sample())) as { building: { scenarios?: unknown[] } };
    raw.building.scenarios = [
      {
        id: "x",
        name: "Old",
        overrides: {},
        roof: { kind: "gable", pitch: 90 },
        bridgeSurcharge: 1e9,
      },
    ];
    const result = fromJson(JSON.stringify(raw));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const variant = evaluateAll(result.building)[1]!;
    expect(variant.energy.heatingDemand).toBeCloseTo(computeEnergy(result.building).heatingDemand);
  });

  it("rejects a JSON with an overlapping opening with the right message", () => {
    const b = sample();
    const storey = b.storeys[0];
    if (!storey) throw new Error("missing storey");
    storey.openings[1] = { ...storey.openings[1]!, offset: 1.5 };
    const result = fromJson(toJson(b));
    expect(result).toEqual({
      ok: false,
      error: { code: "openingsOverlap", path: "building.storeys[0].openings[0]" },
    });
  });
});

describe("validateBuilding", () => {
  it("accepts the sample", () => {
    expect(validateBuilding(sample())).toBeNull();
  });

  it("checks interior openings against their interior wall and round trips them", () => {
    const b = sample();
    const storey = b.storeys[0];
    if (!storey) throw new Error("missing storey");
    storey.interiorWalls.push({ a: { x: 3, y: 0 }, b: { x: 3, y: 4 } });
    const door = {
      id: "door-in",
      wallIndex: storey.interiorWalls.length - 1,
      interior: true,
      kind: "door" as const,
      offset: 1,
      width: 1,
      height: 2.1,
      sill: 0,
      constructionId: storey.openings[0]!.constructionId,
    };
    storey.openings.push(door);
    expect(validateBuilding(b)).toBeNull();
    const back = fromJson(toJson(b));
    expect(back.ok && back.building.storeys[0]?.openings.some((o) => o.interior)).toBe(true);
    storey.openings[storey.openings.length - 1] = { ...door, wallIndex: 7 };
    expect(validateBuilding(b)?.code).toBe("wallIndexOutOfRange");
  });

  it("rejects a bowtie footprint and a clockwise footprint", () => {
    const bowtie = { ...sample(), footprint: [rect[0]!, rect[2]!, rect[1]!, rect[3]!] };
    expect(validateBuilding(bowtie)?.code).toBe("footprintInvalid");
    const cw = { ...sample(), footprint: [...rect].reverse() };
    expect(validateBuilding(cw)?.code).toBe("footprintNotCounterClockwise");
  });

  it("rejects each opening invariant", () => {
    const make = (patch: object) => {
      const b = sample();
      const s = b.storeys[0]!;
      s.openings = [{ ...s.openings[1]!, ...patch }];
      return validateBuilding(b)?.code;
    };
    expect(make({ offset: 9.5 })).toBe("openingOutsideWall");
    expect(make({ offset: -1 })).toBe("openingOutsideWall");
    expect(make({ sill: 2, height: 1.4 })).toBe("openingTooTall");
    expect(make({ kind: "door", sill: 0.3 })).toBe("doorNotOnFloor");
    expect(make({ wallIndex: 7 })).toBe("wallIndexOutOfRange");
    expect(make({ width: 0.01 })).toBe("openingTooSmall");
  });

  it("rejects duplicate ids, unknown zones, bad rooms and bad sizes", () => {
    const dup = sample();
    dup.zones.push({ id: "s1", name: "Clash", color: "#000", heated: true, temperature: 20 });
    expect(validateBuilding(dup)?.code).toBe("duplicateId");

    const zone = sample();
    zone.storeys[0]!.rooms[0]!.zoneId = "nope";
    expect(validateBuilding(zone)?.code).toBe("unknownZone");

    const outside = sample();
    outside.storeys[0]!.rooms[0]!.polygon = [
      { x: -1, y: 0 },
      { x: 1, y: 0 },
      { x: 0, y: 1 },
    ];
    expect(validateBuilding(outside)?.code).toBe("roomOutsideFootprint");

    const mismatch = sample();
    mismatch.storeys[0]!.rooms.pop();
    expect(validateBuilding(mismatch)?.code).toBe("roomAreaMismatch");

    expect(validateBuilding({ ...sample(), wallThickness: 0 })?.code).toBe("wallThicknessInvalid");
    const h = sample();
    h.storeys[1]!.height = -1;
    expect(validateBuilding(h)?.code).toBe("storeyHeightInvalid");
  });

  it("rejects locations outside geographic and rotation ranges", () => {
    expect(
      validateBuilding({ ...sample(), origin: { lat: 91, lon: 13.4, rotation: 0 } })?.code,
    ).toBe("originInvalid");
    expect(
      validateBuilding({ ...sample(), origin: { lat: 52.5, lon: 181, rotation: 0 } })?.code,
    ).toBe("originInvalid");
    expect(
      validateBuilding({ ...sample(), origin: { lat: 52.5, lon: 13.4, rotation: 360 } })?.code,
    ).toBe("originInvalid");
  });
});

describe("migration of files without energy data", () => {
  it("fills constructions, zone heating and opening constructions", () => {
    const b = sample();
    const raw = JSON.parse(toJson(b)) as {
      building: Record<string, unknown> & {
        zones: Record<string, unknown>[];
        storeys: { openings: Record<string, unknown>[] }[];
      };
    };
    const stripped = Object.fromEntries(
      Object.entries(raw.building).filter(
        ([key]) =>
          ![
            "constructions",
            "wallConstructionId",
            "floorConstructionId",
            "roofConstructionId",
            "windowConstructionId",
            "doorConstructionId",
          ].includes(key),
      ),
    ) as typeof raw.building;
    raw.building = stripped;
    for (const z of raw.building.zones) {
      delete z.heated;
      delete z.temperature;
    }
    for (const s of raw.building.storeys) for (const o of s.openings) delete o.constructionId;
    const result = fromJson(JSON.stringify(raw), "de");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.building.constructions.map((c) => c.id)).toContain(PRESET_IDS.wallBrick);
    expect(result.building.constructions.find((c) => c.id === PRESET_IDS.wallBrick)?.name).toBe(
      "Ziegelwand, ungedämmt",
    );
    expect(result.building.wallConstructionId).toBe(PRESET_IDS.wallBrick);
    expect(result.building.zones[0]?.heated).toBe(true);
    expect(result.building.storeys[0]?.openings[0]?.constructionId).toBe(PRESET_IDS.doorOld);
    expect(result.building.storeys[0]?.openings[1]?.constructionId).toBe(PRESET_IDS.glazingDouble);
  });

  it("completes a partially migrated construction catalogue and assignments", () => {
    const raw = JSON.parse(toJson(sample())) as {
      building: {
        constructions: { id: string }[];
        floorConstructionId?: string;
      };
    };
    raw.building.constructions = raw.building.constructions.filter(
      (construction) => construction.id !== PRESET_IDS.floorBare,
    );
    delete raw.building.floorConstructionId;
    const result = fromJson(JSON.stringify(raw), "en");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.building.floorConstructionId).toBe(PRESET_IDS.floorBare);
    expect(result.building.constructions.some((c) => c.id === PRESET_IDS.floorBare)).toBe(true);
  });

  it("rejects an opening that points to a missing construction", () => {
    const b = sample();
    b.storeys[0]!.openings[0]!.constructionId = "nope";
    expect(validateBuilding(b)?.code).toBe("unknownConstruction");
    expect(validateBuilding({ ...b, wallConstructionId: "nope" })?.code).toBe(
      "unknownConstruction",
    );
  });
});
