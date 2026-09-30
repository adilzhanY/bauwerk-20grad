import { pointInPolygon } from "@/geometry/polygon";
import { computeRooms } from "@/geometry/rooms";
import type { Building, InteriorWall, Radiator, Segment, Storey, Vec2 } from "@/geometry/types";
import { DEFAULT_WALL_THICKNESS, HEATED_TEMPERATURE, UNHEATED_TEMPERATURE } from "@/geometry/types";
import { DEFAULT_ASSIGNMENT, PRESET_IDS, defaultConstructions } from "@/geometry/constructions";
import { defaultRoomName, defaultStoreyName } from "@/i18n";
import type { Language } from "@/i18n";
import { createId } from "./ids";

export type ExampleId = "house" | "block" | "altbau" | "tower";

function storey(
  index: number,
  language: Language,
  footprint: Vec2[],
  height: number,
  openings: Omit<Storey["openings"][number], "id" | "constructionId">[],
  interiorWalls: InteriorWall[],
  roomNames: Record<number, string> = {},
  roomZones: Record<number, string> = {},
): Storey {
  const rooms = computeRooms(footprint, interiorWalls, [], {
    createId: () => createId("room"),
    defaultName: (i) => defaultRoomName(i, language),
  });
  rooms.forEach((r, i) => {
    const name = roomNames[i];
    if (name !== undefined) r.name = name;
    const zone = roomZones[i];
    if (zone !== undefined) r.zoneId = zone;
  });
  return {
    id: createId("storey"),
    name: defaultStoreyName(index, language),
    height,
    openings: openings.map((o) => ({
      ...o,
      id: createId("opening"),
      constructionId: o.kind === "door" ? PRESET_IDS.doorOld : PRESET_IDS.glazingDouble,
    })),
    interiorWalls,
    rooms,
  };
}

/** A simple two-storey house, 10 by 8 m, with a door, windows and three rooms downstairs. */
export function exampleHouse(language: Language): Building {
  const footprint: Vec2[] = [
    { x: 0, y: 0 },
    { x: 10, y: 0 },
    { x: 10, y: 8 },
    { x: 0, y: 8 },
  ];
  const heated = createId("zone");
  const unheated = createId("zone");
  const de = language === "de";
  return {
    id: createId("building"),
    name: de ? "Einfamilienhaus" : "Family house",
    footprint,
    wallThickness: DEFAULT_WALL_THICKNESS,
    zones: [
      {
        id: heated,
        name: de ? "Beheizt" : "Heated",
        color: "#e76f51",
        heated: true,
        temperature: HEATED_TEMPERATURE,
      },
      {
        id: unheated,
        name: de ? "Unbeheizt" : "Unheated",
        color: "#6c8ef5",
        heated: false,
        temperature: UNHEATED_TEMPERATURE,
      },
    ],
    constructions: defaultConstructions(language),
    ...DEFAULT_ASSIGNMENT,
    storeys: [
      storey(
        0,
        language,
        footprint,
        3,
        [
          { wallIndex: 0, kind: "door", offset: 4.5, width: 1, height: 2.1, sill: 0 },
          { wallIndex: 0, kind: "window", offset: 1, width: 1.2, height: 1.4, sill: 0.9 },
          { wallIndex: 0, kind: "window", offset: 7.5, width: 1.2, height: 1.4, sill: 0.9 },
          { wallIndex: 2, kind: "window", offset: 2, width: 1.8, height: 1.4, sill: 0.9 },
          { wallIndex: 2, kind: "window", offset: 6, width: 1.8, height: 1.4, sill: 0.9 },
        ],
        [
          { a: { x: 4, y: 0 }, b: { x: 4, y: 8 } },
          { a: { x: 4, y: 4.5 }, b: { x: 10, y: 4.5 } },
        ],
        {
          0: de ? "Küche" : "Kitchen",
          1: de ? "Wohnzimmer" : "Living room",
          2: de ? "Flur" : "Hall",
        },
        { 0: heated, 1: heated, 2: unheated },
      ),
      storey(
        1,
        language,
        footprint,
        2.8,
        [
          { wallIndex: 0, kind: "window", offset: 1, width: 1.2, height: 1.4, sill: 0.9 },
          { wallIndex: 0, kind: "window", offset: 4.4, width: 1.2, height: 1.4, sill: 0.9 },
          { wallIndex: 0, kind: "window", offset: 7.5, width: 1.2, height: 1.4, sill: 0.9 },
          { wallIndex: 2, kind: "window", offset: 4, width: 1.8, height: 1.4, sill: 0.9 },
        ],
        [{ a: { x: 5, y: 0 }, b: { x: 5, y: 8 } }],
        { 0: de ? "Schlafzimmer" : "Bedroom", 1: de ? "Büro" : "Office" },
        { 0: heated, 1: heated },
      ),
    ],
  };
}

/** An L-shaped three-storey block. */
export function exampleBlock(language: Language): Building {
  const footprint: Vec2[] = [
    { x: 0, y: 0 },
    { x: 16, y: 0 },
    { x: 16, y: 6 },
    { x: 8, y: 6 },
    { x: 8, y: 12 },
    { x: 0, y: 12 },
  ];
  const heated = createId("zone");
  const de = language === "de";
  const windows = (wallIndex: number, count: number, length: number) =>
    Array.from({ length: count }, (_, i) => ({
      wallIndex,
      kind: "window" as const,
      offset: Math.round(((i + 0.5) * (length / count) - 0.75) * 10) / 10,
      width: 1.5,
      height: 1.5,
      sill: 0.9,
    }));
  const walls: Segment[] = [
    { a: { x: 4, y: 0 }, b: { x: 4, y: 12 } },
    { a: { x: 12, y: 0 }, b: { x: 12, y: 6 } },
    { a: { x: 0, y: 6 }, b: { x: 8, y: 6 } },
  ];
  const level = (i: number, withDoor: boolean) =>
    storey(
      i,
      language,
      footprint,
      3.2,
      [
        ...(withDoor
          ? [{ wallIndex: 0, kind: "door" as const, offset: 7.5, width: 1.2, height: 2.2, sill: 0 }]
          : []),
        ...windows(0, 4, 16).filter((w) => !withDoor || Math.abs(w.offset - 7.5) > 2),
        ...windows(1, 2, 6),
        ...windows(2, 3, 8),
        ...windows(4, 3, 8),
        ...windows(5, 4, 12),
      ],
      walls,
      {},
      { 0: heated, 1: heated, 2: heated, 3: heated, 4: heated },
    );
  return {
    id: createId("building"),
    name: de ? "Bürogebäude" : "Office block",
    footprint,
    wallThickness: 0.4,
    zones: [
      {
        id: heated,
        name: de ? "Beheizt" : "Heated",
        color: "#2a9d8f",
        heated: true,
        temperature: HEATED_TEMPERATURE,
      },
    ],
    constructions: defaultConstructions(language),
    ...DEFAULT_ASSIGNMENT,
    wallConstructionId: PRESET_IDS.wall1970,
    storeys: [level(0, true), level(1, false), level(2, false)],
  };
}

/** An eighteen-storey office tower, 36 by 24 m, with 162 rooms and 719 openings. */
export function exampleTower(language: Language): Building {
  const de = language === "de";
  const footprint: Vec2[] = [
    { x: 0, y: 0 },
    { x: 36, y: 0 },
    { x: 36, y: 24 },
    { x: 0, y: 24 },
  ];
  const offices = createId("zone");
  const core = createId("zone");
  const interiorWalls: Segment[] = [
    { a: { x: 12, y: 0 }, b: { x: 12, y: 24 } },
    { a: { x: 24, y: 0 }, b: { x: 24, y: 24 } },
    { a: { x: 0, y: 8 }, b: { x: 36, y: 8 } },
    { a: { x: 0, y: 16 }, b: { x: 36, y: 16 } },
  ];
  const windows = (wallIndex: number, count: number, length: number) =>
    Array.from({ length: count }, (_, index) => ({
      wallIndex,
      kind: "window" as const,
      offset: ((index + 0.5) * length) / count - 0.9,
      width: 1.8,
      height: 1.8,
      sill: 0.8,
    }));
  const facadeWindows = [
    ...windows(0, 12, 36),
    ...windows(1, 8, 24),
    ...windows(2, 12, 36),
    ...windows(3, 8, 24),
  ];
  const levels = Array.from({ length: 18 }, (_, index) => {
    const openings =
      index === 0
        ? [
            ...facadeWindows.filter(
              (opening) =>
                opening.wallIndex !== 0 ||
                opening.offset + opening.width < 16 ||
                opening.offset > 20,
            ),
            { wallIndex: 0, kind: "door" as const, offset: 17.2, width: 1.6, height: 2.4, sill: 0 },
          ]
        : facadeWindows;
    const level = storey(index, language, footprint, 3.4, openings, interiorWalls);
    level.openings = level.openings.map((opening) => ({
      ...opening,
      constructionId: opening.kind === "door" ? PRESET_IDS.doorInsulated : PRESET_IDS.glazingTriple,
    }));
    let officeNumber = 0;
    nameRooms(
      level,
      [4, 12, 20].flatMap((y) =>
        [6, 18, 30].map((x) => {
          const isCore = x === 18 && y === 12;
          if (!isCore) officeNumber += 1;
          return {
            at: { x, y },
            name: isCore
              ? `${de ? "Kern" : "Core"} ${index + 1}`
              : `${de ? "Büro" : "Office"} ${index + 1}.${officeNumber}`,
            zone: isCore ? core : offices,
          };
        }),
      ),
    );
    return level;
  });
  return {
    id: createId("building"),
    name: de ? "Berliner Bürohochhaus, 18 Geschosse" : "Berlin office tower, 18 storeys",
    footprint,
    wallThickness: 0.3,
    zones: [
      {
        id: offices,
        name: de ? "Büros" : "Offices",
        color: "#2a9d8f",
        heated: true,
        temperature: HEATED_TEMPERATURE,
      },
      {
        id: core,
        name: de ? "Kernbereich" : "Service core",
        color: "#6c8ef5",
        heated: true,
        temperature: HEATED_TEMPERATURE,
      },
    ],
    constructions: defaultConstructions(language),
    ...DEFAULT_ASSIGNMENT,
    wallConstructionId: PRESET_IDS.wallInsulated,
    floorConstructionId: PRESET_IDS.floorInsulated,
    roofConstructionId: PRESET_IDS.roofInsulated,
    windowConstructionId: PRESET_IDS.glazingTriple,
    doorConstructionId: PRESET_IDS.doorInsulated,
    bridgeDetail: "good",
    roof: { kind: "flat", pitch: 0, overhang: 0, ridgeAxis: "x", parapet: 1.1 },
    storeys: levels,
  };
}

/** Names and zones by a point inside the room, so face order does not matter. */
function nameRooms(s: Storey, labels: { at: Vec2; name: string; zone: string }[]) {
  for (const room of s.rooms) {
    const label = labels.find((l) => pointInPolygon(l.at, room.polygon));
    if (!label) continue;
    room.name = label.name;
    room.zoneId = label.zone;
  }
}

/**
 * The demo project: an unrenovated 1905 apartment house in Berlin Kreuzberg, two
 * full storeys plus a heated attic under a gable roof, placed on the map, with a
 * shop on the ground floor, doors between the rooms, radiators, and two
 * renovation scenarios. Everything the eight-minute demo in DEMO.md touches.
 */
export function exampleAltbau(language: Language): Building {
  const de = language === "de";
  const footprint: Vec2[] = [
    { x: 0, y: 0 },
    { x: 14, y: 0 },
    { x: 14, y: 11 },
    { x: 0, y: 11 },
  ];
  const living = createId("zone");
  const shop = createId("zone");
  const stair = createId("zone");
  const window = (wallIndex: number, offset: number, width = 1.2) => ({
    wallIndex,
    kind: "window" as const,
    offset,
    width,
    height: 1.6,
    sill: 0.85,
  });
  const interiorDoor = (wallIndex: number, offset: number) => ({
    wallIndex,
    kind: "door" as const,
    interior: true,
    offset,
    width: 0.9,
    height: 2.05,
    sill: 0,
  });
  // Load-bearing brick, as the middle and stairwell walls of a Gründerzeit house are.
  const bearing = PRESET_IDS.interiorBearing24;
  // Ground floor: shop at the street, hall and two flats behind it.
  const groundWalls: InteriorWall[] = [
    { a: { x: 0, y: 5 }, b: { x: 14, y: 5 }, constructionId: bearing },
    { a: { x: 6, y: 5 }, b: { x: 6, y: 11 }, constructionId: bearing },
    { a: { x: 8, y: 5 }, b: { x: 8, y: 11 }, constructionId: bearing },
  ];
  const ground = storey(
    0,
    language,
    footprint,
    3.4,
    [
      { wallIndex: 0, kind: "door", offset: 6.5, width: 1.1, height: 2.3, sill: 0 },
      window(0, 1.2, 1.8),
      window(0, 3.8, 1.8),
      window(0, 8.6, 1.8),
      window(0, 11.2, 1.8),
      window(2, 1.5),
      window(2, 4.0),
      window(2, 9.0),
      window(2, 11.5),
      interiorDoor(0, 6.6),
      interiorDoor(1, 2.5),
      interiorDoor(2, 2.5),
    ],
    groundWalls,
  );
  nameRooms(ground, [
    { at: { x: 7, y: 2.5 }, name: de ? "Ladenlokal" : "Shop", zone: shop },
    { at: { x: 3, y: 8 }, name: de ? "Wohnung links" : "Flat left", zone: living },
    { at: { x: 7, y: 8 }, name: de ? "Treppenhaus" : "Stairwell", zone: stair },
    { at: { x: 11, y: 8 }, name: de ? "Wohnung rechts" : "Flat right", zone: living },
  ]);
  // Upper floors: two flats around the stairwell.
  const upperWalls: InteriorWall[] = [
    { a: { x: 6, y: 0 }, b: { x: 6, y: 11 }, constructionId: bearing },
    { a: { x: 8, y: 0 }, b: { x: 8, y: 11 }, constructionId: bearing },
    { a: { x: 0, y: 5.5 }, b: { x: 6, y: 5.5 } },
    { a: { x: 8, y: 5.5 }, b: { x: 14, y: 5.5 } },
  ];
  const upper = (index: number, height: number) =>
    storey(
      index,
      language,
      footprint,
      height,
      [
        window(0, 1.2),
        window(0, 3.6),
        window(0, 6.4, 1.0),
        window(0, 9.2),
        window(0, 11.6),
        window(2, 1.5),
        window(2, 4.0),
        window(2, 9.0),
        window(2, 11.5),
        window(1, 2.0),
        window(1, 7.5),
        window(3, 2.0),
        window(3, 7.5),
        interiorDoor(0, 2.0),
        interiorDoor(0, 8.0),
        interiorDoor(1, 2.0),
        interiorDoor(1, 8.0),
        interiorDoor(2, 3.0),
        interiorDoor(3, 3.0),
      ],
      upperWalls,
    );
  const first = upper(1, 3.2);
  const second = upper(2, 3.2);
  for (const s of [first, second])
    nameRooms(s, [
      { at: { x: 3, y: 2.5 }, name: de ? "Wohnen links" : "Living left", zone: living },
      { at: { x: 3, y: 8 }, name: de ? "Schlafen links" : "Bedroom left", zone: living },
      { at: { x: 7, y: 5 }, name: de ? "Treppenhaus" : "Stairwell", zone: stair },
      { at: { x: 11, y: 2.5 }, name: de ? "Wohnen rechts" : "Living right", zone: living },
      { at: { x: 11, y: 8 }, name: de ? "Schlafen rechts" : "Bedroom right", zone: living },
    ]);
  // One radiator under a street window of every flat.
  const radiator = (wallIndex: number, offset: number, power: number): Radiator => ({
    id: createId("radiator"),
    wallIndex,
    offset,
    width: 1.2,
    height: 0.6,
    power,
  });
  ground.radiators = [radiator(0, 1.2, 2200), radiator(2, 1.5, 1800), radiator(2, 9.0, 1800)];
  first.radiators = [
    radiator(0, 1.2, 1800),
    radiator(0, 9.2, 1800),
    radiator(2, 1.5, 1500),
    radiator(2, 9.0, 1500),
  ];
  second.radiators = [
    radiator(0, 1.2, 1800),
    radiator(0, 9.2, 1800),
    radiator(2, 1.5, 1500),
    radiator(2, 9.0, 1500),
  ];
  return {
    id: createId("building"),
    name: de ? "Altbau Kreuzberg, Baujahr 1905" : "Kreuzberg apartment house, built 1905",
    footprint,
    wallThickness: 0.415,
    origin: { lat: 52.4993, lon: 13.4197, rotation: 24 },
    roof: {
      kind: "gable",
      pitch: 42,
      overhang: 0.4,
      ridgeAxis: "x",
      parapet: 0,
      heatedAttic: true,
    },
    bridgeDetail: "poor",
    zones: [
      {
        id: living,
        name: de ? "Wohnen" : "Living",
        color: "#e76f51",
        heated: true,
        temperature: HEATED_TEMPERATURE,
      },
      {
        id: shop,
        name: de ? "Laden" : "Shop",
        color: "#2a9d8f",
        heated: true,
        temperature: HEATED_TEMPERATURE,
      },
      {
        id: stair,
        name: de ? "Treppenhaus" : "Stairwell",
        color: "#6c8ef5",
        heated: false,
        temperature: UNHEATED_TEMPERATURE,
      },
    ],
    constructions: defaultConstructions(language),
    ...DEFAULT_ASSIGNMENT,
    scenarios: [
      {
        id: "windows-roof",
        name: de ? "Fenster und Dach" : "Windows and roof",
        overrides: { window: PRESET_IDS.glazingTriple, roof: PRESET_IDS.roofInsulated },
      },
      {
        id: "facade",
        name: de ? "Fassade dämmen" : "Insulate the facade",
        overrides: { wall: PRESET_IDS.wallInsulated },
        bridgeDetail: "good",
      },
    ],
    storeys: [ground, first, second],
  };
}

export function example(id: ExampleId, language: Language): Building {
  if (id === "altbau") return exampleAltbau(language);
  if (id === "tower") return exampleTower(language);
  return id === "house" ? exampleHouse(language) : exampleBlock(language);
}
