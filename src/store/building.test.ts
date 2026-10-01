import { beforeEach, describe, expect, it } from "vitest";
import { createEditorStore, createDefaultBuilding } from "./building";
import type { EditorStore } from "./building";
import { HISTORY_LIMIT } from "./history";
import { isCounterClockwise } from "@/geometry/polygon";
import { resetIds } from "@/lib/ids";
import { exampleAltbau } from "@/lib/examples";
import { PRESET_IDS } from "@/geometry/constructions";
import type { Building } from "@/geometry/types";

type Store = ReturnType<typeof createEditorStore>;

let store: Store;

beforeEach(() => {
  resetIds();
  store = createEditorStore();
});

const storeyId = () => store.getState().building.storeys[0]?.id ?? "";

function withRoom(): string {
  // The default building already derives one room covering the whole footprint.
  return store.getState().building.storeys[0]?.rooms[0]?.id ?? "";
}

interface ActionCase {
  name: string;
  arrange?: () => void;
  act: (s: EditorStore) => void;
}

const cases: ActionCase[] = [
  {
    name: "setFootprintVertex",
    act: (s) => {
      s.setFootprintVertex(1, { x: 12, y: 0 });
    },
  },
  {
    name: "addStorey",
    act: (s) => {
      s.addStorey();
    },
  },
  {
    name: "removeStorey",
    act: (s) => {
      s.removeStorey(storeyId());
    },
  },
  {
    name: "setStoreyHeight",
    act: (s) => {
      s.setStoreyHeight(storeyId(), 2.7);
    },
  },
  {
    name: "renameStorey",
    act: (s) => {
      s.renameStorey(storeyId(), "Keller");
    },
  },
  {
    name: "setWallThickness",
    act: (s) => {
      s.setWallThickness(0.4);
    },
  },
  {
    name: "resizeFootprint",
    act: (s) => {
      s.resizeFootprint(12, 9);
    },
  },
  {
    name: "addOpening",
    act: (s) =>
      s.addOpening(storeyId(), {
        wallIndex: 0,
        kind: "window",
        offset: 1,
        width: 1.2,
        height: 1.4,
        sill: 0.9,
      }),
  },
  {
    name: "updateOpening",
    arrange: () => {
      store.getState().addOpening(storeyId(), {
        wallIndex: 0,
        kind: "window",
        offset: 1,
        width: 1.2,
        height: 1.4,
        sill: 0.9,
      });
    },
    act: (s) => {
      const id = s.building.storeys[0]?.openings[0]?.id ?? "";
      s.updateOpening(storeyId(), id, { width: 2, offset: 3 });
    },
  },
  {
    name: "removeOpening",
    arrange: () => {
      store.getState().addOpening(storeyId(), {
        wallIndex: 1,
        kind: "door",
        offset: 0.5,
        width: 1,
        height: 2.1,
        sill: 0,
      });
    },
    act: (s) => {
      const id = s.building.storeys[0]?.openings[0]?.id ?? "";
      s.removeOpening(storeyId(), id);
    },
  },
  {
    name: "addInteriorWall",
    act: (s) => {
      s.addInteriorWall(storeyId(), { a: { x: 5, y: 0 }, b: { x: 5, y: 8 } });
    },
  },
  {
    name: "removeInteriorWall",
    arrange: () => {
      store.getState().addInteriorWall(storeyId(), { a: { x: 5, y: 0 }, b: { x: 5, y: 8 } });
    },
    act: (s) => {
      s.removeInteriorWall(storeyId(), 0);
    },
  },
  {
    name: "renameRoom",
    arrange: () => {
      withRoom();
    },
    act: (s) => {
      s.renameRoom(storeyId(), withRoom(), "Bad");
    },
  },
  {
    name: "assignRoomToZone",
    arrange: () => {
      withRoom();
      store.getState().addZone("Heated", "#ff0000");
    },
    act: (s) => {
      s.assignRoomToZone(storeyId(), withRoom(), s.building.zones[0]?.id);
    },
  },
  { name: "addZone", act: (s) => s.addZone("Heated", "#ff0000") },
  {
    name: "updateZone",
    arrange: () => {
      store.getState().addZone("Heated", "#ff0000");
    },
    act: (s) => {
      s.updateZone(s.building.zones[0]?.id ?? "", { name: "Beheizt", color: "#00ff00" });
    },
  },
  {
    name: "removeZone",
    arrange: () => {
      withRoom();
      const zoneId = store.getState().addZone("Heated", "#ff0000");
      store.getState().assignRoomToZone(storeyId(), withRoom(), zoneId);
    },
    act: (s) => {
      s.removeZone(s.building.zones[0]?.id ?? "");
    },
  },
  {
    name: "loadBuilding",
    act: (s) => {
      const b: Building = { ...createDefaultBuilding(), name: "Imported", wallThickness: 0.5 };
      s.loadBuilding(b);
    },
  },
];

describe("undo and redo", () => {
  for (const c of cases) {
    it(`${c.name}: undo restores the previous building, redo restores the next`, () => {
      c.arrange?.();
      const before = structuredClone(store.getState().building);
      c.act(store.getState());
      const after = structuredClone(store.getState().building);
      expect(after).not.toEqual(before);

      store.getState().undo();
      expect(store.getState().building).toEqual(before);

      store.getState().redo();
      expect(store.getState().building).toEqual(after);

      store.getState().undo();
      store.getState().redo();
      expect(store.getState().building).toEqual(after);
    });
  }

  it("every action actually changes the building", () => {
    expect(cases.length).toBeGreaterThanOrEqual(17);
  });

  it("undo and redo on an empty history are no-ops", () => {
    const before = store.getState().building;
    store.getState().undo();
    store.getState().redo();
    expect(store.getState().building).toBe(before);
  });

  it("a new action after undo drops the redo stack", () => {
    store.getState().setWallThickness(0.4);
    store.getState().setWallThickness(0.5);
    store.getState().undo();
    expect(store.getState().future).toHaveLength(1);
    store.getState().setWallThickness(0.6);
    expect(store.getState().future).toHaveLength(0);
    expect(store.getState().building.wallThickness).toBe(0.6);
  });

  it("a no-op action does not create a history entry", () => {
    store.getState().renameStorey("missing", "Nothing");
    expect(store.getState().past).toHaveLength(0);
  });

  it(`caps the history at ${HISTORY_LIMIT} entries`, () => {
    for (let i = 0; i < HISTORY_LIMIT + 50; i++) {
      store.getState().setWallThickness(0.1 + i * 0.001);
    }
    expect(store.getState().past).toHaveLength(HISTORY_LIMIT);
    for (let i = 0; i < HISTORY_LIMIT; i++) store.getState().undo();
    expect(store.getState().past).toHaveLength(0);
    expect(store.getState().building.wallThickness).toBeCloseTo(0.1 + 49 * 0.001);
  });
});

describe("UI state and history", () => {
  it("selection, tool and language are not recorded and not touched by undo", () => {
    store.getState().setWallThickness(0.4);
    store.getState().select({ kind: "storey", id: storeyId() });
    store.getState().setTool("opening");
    store.getState().setLanguage("de");
    expect(store.getState().past).toHaveLength(1);

    store.getState().undo();
    const s = store.getState();
    expect(s.building.wallThickness).toBe(0.3);
    expect(s.selection).toEqual({ kind: "storey", id: storeyId() });
    expect(s.tool).toBe("opening");
    expect(s.language).toBe("de");
    expect(s.building.storeys[0]?.name).toBe("Erdgeschoss");
  });

  it("gives a viewer only the tools that look, and drops a drawing tool when edit rights go", () => {
    store.getState().setTool("interiorWall");
    store.getState().setProjectRole("viewer");
    expect(store.getState().tool).toBe("select");
    store.getState().setTool("footprint");
    expect(store.getState().tool).toBe("select");
    store.getState().setTool("measure");
    expect(store.getState().tool).toBe("measure");
    store.getState().setProjectRole("editor");
    store.getState().setTool("footprint");
    expect(store.getState().tool).toBe("footprint");
    store.getState().setProjectRole(null);
  });

  it("localizes known model names in both directions without changing custom names", () => {
    store.getState().renameBuilding("Haus Müller");
    store.getState().setLanguage("de");
    expect(store.getState().building.name).toBe("Haus Müller");
    expect(store.getState().building.storeys[0]?.name).toBe("Erdgeschoss");
    store.getState().setLanguage("en");
    expect(store.getState().building.name).toBe("Haus Müller");
    expect(store.getState().building.storeys[0]?.name).toBe("Ground floor");
  });

  it("localizes known names when buildings enter a German store", () => {
    const germanStore = createEditorStore({ language: "de", building: exampleAltbau("en") });
    expect(germanStore.getState().building.name).toBe("Altbau Kreuzberg, Baujahr 1905");

    germanStore.getState().loadBuilding(exampleAltbau("en"));
    expect(germanStore.getState().building.storeys[0]?.rooms.map((room) => room.name)).toContain(
      "Ladenlokal",
    );

    germanStore.getState().applyRemoteBuilding(exampleAltbau("en"));
    expect(germanStore.getState().building.scenarios?.[0]?.name).toBe("Fenster und Dach");
  });

  it("clearSelection and setActiveStorey do not create history", () => {
    store.getState().addStorey();
    const second = store.getState().activeStoreyId ?? "";
    store.getState().setActiveStorey(storeyId());
    store.getState().setActiveStorey(second);
    store.getState().clearSelection();
    expect(store.getState().past).toHaveLength(1);
  });

  it("clears model references that no longer exist after undo and redo", () => {
    store.getState().addStorey();
    const second = store.getState().activeStoreyId ?? "";
    const zone = store.getState().addZone("Office", "#ff0000");
    const scenario = store.getState().addScenario("Insulation");
    store.getState().setActiveZone(zone);
    store.getState().setViewScenario(scenario);
    store.getState().select({ kind: "storey", id: second });
    store.getState().setHovered({ kind: "storey", id: second });

    store.getState().undo();
    expect(store.getState().viewScenarioId).toBeNull();
    store.getState().undo();
    expect(store.getState().activeZoneId).toBeNull();
    store.getState().undo();
    expect(store.getState().activeStoreyId).toBe(storeyId());
    expect(store.getState().selection).toBeNull();
    expect(store.getState().hovered).toBeNull();
  });
});

describe("store behaviour", () => {
  it("rejects footprint edits that make the polygon invalid", () => {
    const before = structuredClone(store.getState().building.footprint);
    store.getState().setFootprintVertex(1, { x: 0, y: 8 });
    expect(store.getState().building.footprint).toEqual(before);
    store.getState().setFootprintVertex(1, { x: Number.NaN, y: 0 });
    expect(store.getState().building.footprint).toEqual(before);
    store.getState().setFootprint([
      { x: 0, y: 0 },
      { x: Number.POSITIVE_INFINITY, y: 0 },
      { x: 0, y: 1 },
    ]);
    expect(store.getState().building.footprint).toEqual(before);
    expect(store.getState().past).toHaveLength(0);
  });

  it("translates the building and re-centres the origin onto it", () => {
    store.getState().setOrigin({ lat: 52.5, lon: 13.4, rotation: 0 });
    store.getState().translateBuilding({ x: 10, y: 0 });
    expect(store.getState().building.footprint[0]).toEqual({ x: 10, y: 0 });
    store.getState().recentreOrigin();
    const b = store.getState().building;
    const xs = b.footprint.map((p) => p.x);
    expect((Math.min(...xs) + Math.max(...xs)) / 2).toBeCloseTo(0, 6);
    // 15 m east of the old origin: about 0.00022 degrees of longitude at 52.5° N.
    expect(b.origin?.lon ?? 0).toBeGreaterThan(13.4001);
    expect(b.origin?.lat ?? 0).toBeCloseTo(52.5, 4);
    store.getState().undo();
    expect(store.getState().building.footprint[0]).toEqual({ x: 10, y: 0 });
  });
  it("removing an interior wall drops its openings and renumbers the rest", () => {
    const sid = storeyId();
    store.getState().addInteriorWall(sid, { a: { x: 3, y: 0 }, b: { x: 3, y: 8 } });
    store.getState().addInteriorWall(sid, { a: { x: 6, y: 0 }, b: { x: 6, y: 8 } });
    const door = {
      kind: "door" as const,
      offset: 1,
      width: 1,
      height: 2.1,
      sill: 0,
      interior: true,
    };
    store.getState().addOpening(sid, { ...door, wallIndex: 0 });
    const kept = store.getState().addOpening(sid, { ...door, wallIndex: 1 });
    store
      .getState()
      .addOpening(sid, { kind: "window", offset: 1, width: 1, height: 1, sill: 1, wallIndex: 0 });
    store.getState().removeInteriorWall(sid, 0);
    const openings = store.getState().building.storeys[0]?.openings ?? [];
    expect(openings).toHaveLength(2);
    expect(openings.find((o) => o.id === kept)?.wallIndex).toBe(0);
    expect(openings.find((o) => !o.interior)?.wallIndex).toBe(0);
  });

  it("adjusts only an interior wall selection on the affected storey", () => {
    const first = storeyId();
    store.getState().addInteriorWall(first, { a: { x: 3, y: 0 }, b: { x: 3, y: 8 } });
    store.getState().addInteriorWall(first, { a: { x: 6, y: 0 }, b: { x: 6, y: 8 } });
    store.getState().select({ kind: "interiorWall", storeyId: first, index: 1 });
    store.getState().removeInteriorWall(first, 0);
    expect(store.getState().selection).toEqual({ kind: "interiorWall", storeyId: first, index: 0 });

    store.getState().addStorey();
    const second = store.getState().activeStoreyId ?? "";
    store.getState().addInteriorWall(second, { a: { x: 4, y: 0 }, b: { x: 4, y: 8 } });
    store.getState().select({ kind: "interiorWall", storeyId: second, index: 0 });
    store.getState().removeInteriorWall(first, 0);
    expect(store.getState().selection).toEqual({
      kind: "interiorWall",
      storeyId: second,
      index: 0,
    });
  });

  it("resets document scoped UI after loading a building", () => {
    store.getState().setUnderlay({
      url: "data:image/png;base64,x",
      widthMetres: 10,
      aspect: 1,
      x: 0,
      y: 0,
      opacity: 0.5,
    });
    store.getState().setMeasurement({ a: { x: 0, y: 0 }, b: { x: 1, y: 1 } });
    store.getState().setProposal({ footprint: [], interiorWalls: [] });
    store.getState().setRenovatedView(true);
    store.getState().loadBuilding(exampleAltbau("en"));
    const state = store.getState();
    expect(state.activeZoneId).toBeNull();
    expect(state.selection).toBeNull();
    expect(state.hovered).toBeNull();
    expect(state.renovatedView).toBe(false);
    expect(state.viewScenarioId).toBeNull();
    expect(state.underlay).toBeNull();
    expect(state.measurement).toBeNull();
    expect(state.proposal).toBeNull();
  });
  it("derives rooms when interior walls change and keeps names", () => {
    const sid = storeyId();
    expect(store.getState().building.storeys[0]?.rooms).toHaveLength(1);
    store.getState().renameRoom(sid, withRoom(), "Kitchen");
    store.getState().addInteriorWall(sid, { a: { x: 4, y: 0 }, b: { x: 4, y: 8 } });
    const rooms = store.getState().building.storeys[0]?.rooms ?? [];
    expect(rooms).toHaveLength(2);
    expect(rooms.map((r) => r.name).sort()).toEqual(["Kitchen", "Room 1"]);
    expect(rooms.reduce((s, r) => s + r.area, 0)).toBeCloseTo(80, 6);
    store.getState().undo();
    expect(store.getState().building.storeys[0]?.rooms).toHaveLength(1);
  });

  it("starts with a 10 by 8 rectangle, one storey, no openings", () => {
    const b = store.getState().building;
    expect(b.footprint).toEqual([
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 10, y: 8 },
      { x: 0, y: 8 },
    ]);
    expect(b.storeys).toHaveLength(1);
    expect(b.storeys[0]?.openings).toEqual([]);
    expect(b.storeys[0]?.name).toBe("Ground floor");
    expect(b.wallThickness).toBe(0.3);
    expect(store.getState().activeStoreyId).toBe(b.storeys[0]?.id);
  });

  it("names new storeys in the active language", () => {
    store.getState().setLanguage("de");
    store.getState().addStorey();
    store.getState().addStorey();
    const names = store.getState().building.storeys.map((s) => s.name);
    expect(names).toEqual(["Erdgeschoss", "1. Obergeschoss", "2. Obergeschoss"]);
  });

  it("removing the active storey moves the active storey to a neighbour", () => {
    store.getState().addStorey();
    const second = store.getState().activeStoreyId ?? "";
    store.getState().removeStorey(second);
    expect(store.getState().activeStoreyId).toBe(storeyId());
    store.getState().removeStorey(storeyId());
    expect(store.getState().activeStoreyId).toBeNull();
    expect(store.getState().building.storeys).toHaveLength(0);
  });

  it("removing a zone unassigns its rooms", () => {
    withRoom();
    const zoneId = store.getState().addZone("Heated", "#ff0000");
    store.getState().assignRoomToZone(storeyId(), withRoom(), zoneId);
    expect(store.getState().building.storeys[0]?.rooms[0]?.zoneId).toBe(zoneId);
    store.getState().removeZone(zoneId);
    expect(store.getState().building.storeys[0]?.rooms[0]?.zoneId).toBeUndefined();
  });

  it("removing a selected element clears the selection", () => {
    const id = store.getState().addOpening(storeyId(), {
      wallIndex: 0,
      kind: "window",
      offset: 1,
      width: 1,
      height: 1,
      sill: 1,
    });
    store.getState().select({ kind: "opening", storeyId: storeyId(), id });
    store.getState().removeOpening(storeyId(), id);
    expect(store.getState().selection).toBeNull();
  });
});

describe("footprint editing and deleteSelection", () => {
  it("inserts a vertex at an edge midpoint and can remove it again", () => {
    store.getState().insertFootprintVertex(0);
    expect(store.getState().building.footprint).toHaveLength(5);
    expect(store.getState().building.footprint[1]).toEqual({ x: 5, y: 0 });
    expect(store.getState().selection).toEqual({ kind: "vertex", index: 1 });
    store.getState().deleteSelection();
    expect(store.getState().building.footprint).toHaveLength(4);
    store.getState().undo();
    expect(store.getState().building.footprint).toHaveLength(5);
  });

  it("refuses to remove a vertex from a triangle", () => {
    store.getState().loadBuilding({
      ...store.getState().building,
      footprint: [
        { x: 0, y: 0 },
        { x: 6, y: 0 },
        { x: 0, y: 6 },
      ],
    });
    store.getState().removeFootprintVertex(0);
    expect(store.getState().building.footprint).toHaveLength(3);
  });

  it("removing a vertex shifts opening wall indices and drops the merged edges' openings", () => {
    const sid = storeyId();
    store.getState().insertFootprintVertex(0); // edges: 0 (0,0)-(5,0), 1 (5,0)-(10,0), 2, 3, 4
    store.getState().setFootprintVertex(1, { x: 5, y: -2 });
    const onEdge1 = store.getState().addOpening(sid, {
      wallIndex: 1,
      kind: "window",
      offset: 1,
      width: 1,
      height: 1,
      sill: 1,
    });
    const onEdge3 = store.getState().addOpening(sid, {
      wallIndex: 3,
      kind: "window",
      offset: 1,
      width: 1,
      height: 1,
      sill: 1,
    });
    store.getState().removeFootprintVertex(1);
    const openings = store.getState().building.storeys[0]?.openings ?? [];
    expect(openings.find((o) => o.id === onEdge1)).toBeUndefined();
    expect(openings.find((o) => o.id === onEdge3)?.wallIndex).toBe(2);
  });

  it("deleteSelection removes openings, walls, storeys and zones but not rooms", () => {
    const sid = storeyId();
    const id = store.getState().addOpening(sid, {
      wallIndex: 0,
      kind: "door",
      offset: 1,
      width: 1,
      height: 2,
      sill: 0,
    });
    store.getState().select({ kind: "opening", storeyId: sid, id });
    store.getState().deleteSelection();
    expect(store.getState().building.storeys[0]?.openings).toHaveLength(0);

    store.getState().addInteriorWall(sid, { a: { x: 4, y: 0 }, b: { x: 4, y: 8 } });
    store.getState().select({ kind: "interiorWall", storeyId: sid, index: 0 });
    store.getState().deleteSelection();
    expect(store.getState().building.storeys[0]?.interiorWalls).toHaveLength(0);

    const roomId = withRoom();
    store.getState().select({ kind: "room", storeyId: sid, id: roomId });
    store.getState().deleteSelection();
    expect(store.getState().building.storeys[0]?.rooms).toHaveLength(1);

    const zoneId = store.getState().addZone("Heated", "#f00");
    store.getState().setActiveZone(zoneId);
    store.getState().select({ kind: "zone", id: zoneId });
    store.getState().deleteSelection();
    expect(store.getState().building.zones).toHaveLength(0);
    expect(store.getState().activeZoneId).toBeNull();

    store.getState().select({ kind: "storey", id: sid });
    store.getState().deleteSelection();
    expect(store.getState().building.storeys).toHaveLength(0);
  });

  it("moveStorey reorders and is undoable", () => {
    store.getState().addStorey();
    const [first, second] = store.getState().building.storeys.map((s) => s.id);
    store.getState().moveStorey(first ?? "", 1);
    expect(store.getState().building.storeys.map((s) => s.id)).toEqual([second, first]);
    store.getState().moveStorey(first ?? "", 1);
    expect(store.getState().building.storeys.map((s) => s.id)).toEqual([second, first]);
    store.getState().undo();
    expect(store.getState().building.storeys.map((s) => s.id)).toEqual([first, second]);
  });
});

describe("energy actions", () => {
  it("assigns constructions, edits U-values and toggles zone heating, all undoable", () => {
    const sid = storeyId();
    store.getState().assignConstruction({ kind: "wall" }, "c_wall_insulated");
    expect(store.getState().building.wallConstructionId).toBe("c_wall_insulated");
    store.getState().assignConstruction({ kind: "wall" }, "missing");
    expect(store.getState().building.wallConstructionId).toBe("c_wall_insulated");

    const id = store.getState().addOpening(sid, {
      wallIndex: 0,
      kind: "window",
      offset: 1,
      width: 1,
      height: 1,
      sill: 1,
    });
    expect(store.getState().building.storeys[0]?.openings[0]?.constructionId).toBe(
      "c_glazing_double",
    );
    store.getState().assignConstruction({ kind: "opening", storeyId: sid, id }, "c_glazing_triple");
    expect(store.getState().building.storeys[0]?.openings[0]?.constructionId).toBe(
      "c_glazing_triple",
    );

    // Layered constructions compute their U; a typed value is overridden by the layers.
    const before = store
      .getState()
      .building.constructions.find((c) => c.id === "c_wall_insulated")?.uValue;
    store.getState().updateConstruction("c_wall_insulated", { uValue: 0.2 });
    expect(
      store.getState().building.constructions.find((c) => c.id === "c_wall_insulated")?.uValue,
    ).toBe(before);
    // Windows have no layers, so their U is typed.
    store.getState().updateConstruction("c_glazing_triple", { uValue: 0.7 });
    expect(
      store.getState().building.constructions.find((c) => c.id === "c_glazing_triple")?.uValue,
    ).toBe(0.7);

    const zoneId = store.getState().addZone("Cellar", "#000", false);
    expect(store.getState().building.zones[0]?.temperature).toBe(10);
    store.getState().setZoneHeated(zoneId, true);
    expect(store.getState().building.zones[0]?.temperature).toBe(20);

    const entries = store.getState().past.length;
    store.getState().undo();
    expect(store.getState().building.zones[0]?.heated).toBe(false);
    expect(store.getState().past.length).toBe(entries - 1);
  });
});

describe("geo placement", () => {
  it("sets and clears the origin, undoable", () => {
    store.getState().setOrigin({ lat: 52.5, lon: 13.4, rotation: 15 });
    expect(store.getState().building.origin).toEqual({ lat: 52.5, lon: 13.4, rotation: 15 });
    store.getState().setOrigin(undefined);
    expect(store.getState().building.origin).toBeUndefined();
    store.getState().undo();
    expect(store.getState().building.origin?.rotation).toBe(15);
  });

  it("setFootprint replaces the footprint, drops openings and recomputes rooms", () => {
    const sid = storeyId();
    store
      .getState()
      .addOpening(sid, { wallIndex: 0, kind: "window", offset: 1, width: 1, height: 1, sill: 1 });
    store.getState().setFootprint(
      [
        { x: 0, y: 0 },
        { x: 0, y: 6 },
        { x: 6, y: 6 },
        { x: 6, y: 0 },
      ],
      { lat: 52.5, lon: 13.4, rotation: 0 },
    );
    const b = store.getState().building;
    expect(isCounterClockwise(b.footprint)).toBe(true); // reoriented from the clockwise input
    expect(b.storeys[0]?.openings).toHaveLength(0);
    expect(b.storeys[0]?.rooms[0]?.area).toBe(36);
    expect(b.origin?.lat).toBe(52.5);
  });
});

describe("duplicateStorey", () => {
  it("copies openings, walls and rooms with fresh ids above the source, undoable", () => {
    const sid = storeyId();
    store
      .getState()
      .addOpening(sid, { wallIndex: 0, kind: "window", offset: 1, width: 1, height: 1, sill: 1 });
    store.getState().addInteriorWall(sid, { a: { x: 4, y: 0 }, b: { x: 4, y: 8 } });
    store
      .getState()
      .renameRoom(sid, store.getState().building.storeys[0]?.rooms[0]?.id ?? "", "Kitchen");
    store.getState().duplicateStorey(sid);
    const [source, copy] = store.getState().building.storeys;
    expect(copy?.name).toBe("1st floor");
    expect(copy?.openings).toHaveLength(1);
    expect(copy?.openings[0]?.id).not.toBe(source?.openings[0]?.id);
    expect(copy?.interiorWalls).toEqual(source?.interiorWalls);
    expect(copy?.rooms.map((r) => r.name)).toEqual(source?.rooms.map((r) => r.name));
    expect(copy?.rooms[0]?.id).not.toBe(source?.rooms[0]?.id);
    expect(store.getState().activeStoreyId).toBe(copy?.id);
    store.getState().undo();
    expect(store.getState().building.storeys).toHaveLength(1);
  });
});

describe("history batching", () => {
  it("a gesture of many live changes is one undo step", () => {
    store.getState().beginBatch();
    for (let i = 1; i <= 20; i++) store.getState().setWallThickness(0.3 + i * 0.01);
    store.getState().endBatch();
    expect(store.getState().building.wallThickness).toBeCloseTo(0.5);
    expect(store.getState().past).toHaveLength(1);
    store.getState().undo();
    expect(store.getState().building.wallThickness).toBe(0.3);
    store.getState().redo();
    expect(store.getState().building.wallThickness).toBeCloseTo(0.5);
  });

  it("changes after endBatch record normally again", () => {
    store.getState().beginBatch();
    store.getState().setWallThickness(0.4);
    store.getState().setWallThickness(0.45);
    store.getState().endBatch();
    store.getState().setWallThickness(0.5);
    expect(store.getState().past).toHaveLength(2);
  });

  it("an empty batch records nothing", () => {
    store.getState().beginBatch();
    store.getState().endBatch();
    expect(store.getState().past).toHaveLength(0);
  });

  it("keeps a nested batch open until its outer batch ends", () => {
    store.getState().beginBatch();
    store.getState().setWallThickness(0.4);
    store.getState().beginBatch();
    store.getState().setWallThickness(0.45);
    store.getState().endBatch();
    store.getState().setWallThickness(0.5);
    expect(store.getState().past).toHaveLength(1);
    store.getState().endBatch();
    store.getState().setWallThickness(0.55);
    expect(store.getState().past).toHaveLength(2);
    store.getState().undo();
    expect(store.getState().building.wallThickness).toBe(0.5);
    store.getState().undo();
    expect(store.getState().building.wallThickness).toBe(0.3);
  });
});

describe("layer actions", () => {
  const wall = () => store.getState().building.constructions.find((c) => c.id === "c_wall_brick")!;

  it("adding, editing, moving and removing layers recomputes U and is undoable", () => {
    const u0 = wall().uValue;
    store.getState().addLayer("c_wall_brick", { name: "EPS", thickness: 0.1, conductivity: 0.035 });
    expect(wall().layers).toHaveLength(4);
    expect(wall().uValue).toBeLessThan(u0 / 3);
    const eps = wall().layers![3]!;
    store.getState().updateLayer("c_wall_brick", eps.id, { thickness: 0.2 });
    const u2 = wall().uValue;
    expect(u2).toBeLessThan(wall().layers![3]!.thickness > 0.15 ? u0 : 0);
    store.getState().moveLayer("c_wall_brick", eps.id, -1);
    expect(wall().layers![2]!.id).toBe(eps.id);
    expect(wall().uValue).toBeCloseTo(u2); // order does not change U
    store.getState().removeLayer("c_wall_brick", eps.id);
    expect(wall().layers).toHaveLength(3);
    expect(wall().uValue).toBeCloseTo(u0);
    store.getState().undo();
    expect(wall().layers).toHaveLength(4);
    expect(store.getState().past).toHaveLength(3);
  });

  it("removing the last layer makes the construction typed again", () => {
    for (const l of [...wall().layers!]) store.getState().removeLayer("c_wall_brick", l.id);
    expect(wall().layers).toBeUndefined();
    store.getState().updateConstruction("c_wall_brick", { uValue: 0.9 });
    expect(wall().uValue).toBe(0.9);
  });
});

describe("roof", () => {
  it("setRoof merges onto the defaults and is undoable", () => {
    store.getState().setRoof({ kind: "gable", pitch: 40 });
    expect(store.getState().building.roof).toMatchObject({
      kind: "gable",
      pitch: 40,
      overhang: 0.3,
      ridgeAxis: "x",
    });
    store.getState().setRoof({ ridgeAxis: "y" });
    expect(store.getState().building.roof?.pitch).toBe(40);
    store.getState().undo();
    expect(store.getState().building.roof?.ridgeAxis).toBe("x");
  });
});

describe("footprint proposal", () => {
  it("keeps a pending proposal aligned through rotation and recentering", () => {
    store.getState().translateBuilding({ x: 10, y: 5 });
    store.getState().setProposal({
      footprint: structuredClone(store.getState().building.footprint),
      interiorWalls: [
        {
          segment: { a: { x: 15, y: 5 }, b: { x: 15, y: 13 } },
          confidence: 1,
          enabled: true,
        },
      ],
    });
    store.getState().rotateBuilding(90);
    expect(store.getState().proposal?.footprint).toEqual(store.getState().building.footprint);
    store.getState().recentreOrigin();
    expect(store.getState().proposal?.footprint).toEqual(store.getState().building.footprint);
    expect(store.getState().proposal?.interiorWalls[0]?.segment).toEqual({
      a: { x: 4, y: 0 },
      b: { x: -4, y: 0 },
    });
  });

  it("acceptProposal replaces footprint and walls of the active storey in one undo step", () => {
    const sid = storeyId();
    store.getState().addInteriorWall(sid, { a: { x: 2, y: 0 }, b: { x: 2, y: 8 } });
    const entries = store.getState().past.length;
    store.getState().setProposal({
      footprint: [
        { x: 0, y: 0 },
        { x: 12, y: 0 },
        { x: 12, y: 6 },
        { x: 0, y: 6 },
      ],
      interiorWalls: [
        { segment: { a: { x: 6, y: 0 }, b: { x: 6, y: 6 } }, confidence: 0.9, enabled: true },
        { segment: { a: { x: 0, y: 3 }, b: { x: 6, y: 3 } }, confidence: 0.4, enabled: false },
      ],
    });
    store.getState().toggleProposalWall(1);
    store.getState().acceptProposal();
    const b = store.getState().building;
    expect(b.footprint).toHaveLength(4);
    // The wall joining the other in a T splits it: three walls from joint to joint.
    expect(b.storeys[0]?.interiorWalls).toHaveLength(3);
    expect(b.storeys[0]?.rooms).toHaveLength(3);
    expect(store.getState().proposal).toBeNull();
    expect(store.getState().past.length).toBe(entries + 1);
    store.getState().undo();
    expect(store.getState().building.footprint[1]).toEqual({ x: 10, y: 0 });
    expect(store.getState().building.storeys[0]?.interiorWalls).toHaveLength(1);
  });
});

describe("heating elements", () => {
  it("adds, updates and removes radiators, heat pumps and pipes, all undoable", () => {
    const sid = storeyId();
    const rad = store
      .getState()
      .addRadiator(sid, { wallIndex: 0, offset: 1, width: 1, height: 0.6, power: 900 });
    store.getState().updateRadiator(sid, rad, { power: 1200 });
    expect(store.getState().building.storeys[0]?.radiators?.[0]?.power).toBe(1200);
    const pump = store.getState().addHeatPump({ position: { x: -2, y: 2 }, power: 8, kind: "air" });
    store.getState().updateHeatPump(pump, { kind: "ground" });
    expect(store.getState().building.heatPumps?.[0]?.kind).toBe("ground");
    const pipe = store.getState().addPipe(sid, [
      { x: 1, y: 1 },
      { x: 3, y: 1 },
    ]);
    expect(store.getState().building.storeys[0]?.pipes).toHaveLength(1);
    store.getState().select({ kind: "pipe", storeyId: sid, id: pipe });
    store.getState().deleteSelection();
    expect(store.getState().building.storeys[0]?.pipes).toHaveLength(0);
    store.getState().select({ kind: "heatPump", id: pump });
    store.getState().deleteSelection();
    expect(store.getState().building.heatPumps).toHaveLength(0);
    store.getState().select({ kind: "radiator", storeyId: sid, id: rad });
    store.getState().deleteSelection();
    expect(store.getState().building.storeys[0]?.radiators).toHaveLength(0);
    for (let i = 0; i < 3; i++) store.getState().undo();
    expect(store.getState().building.storeys[0]?.pipes).toHaveLength(1);
    expect(store.getState().building.heatPumps).toHaveLength(1);
  });
});

describe("scenarios", () => {
  it("adds, edits, duplicates and removes scenarios, undoable, and the view follows", () => {
    const id = store.getState().addScenario("Windows");
    store.getState().updateScenario(id, { overrides: { window: "c_glazing_triple" } });
    expect(store.getState().building.scenarios?.[0]?.overrides.window).toBe("c_glazing_triple");
    store.getState().setViewScenario(id);
    expect(store.getState().viewScenarioId).toBe(id);
    const copy = store.getState().addScenario("Windows 2", store.getState().building.scenarios![0]);
    expect(store.getState().building.scenarios?.[1]?.overrides.window).toBe("c_glazing_triple");
    store.getState().removeScenario(id);
    expect(store.getState().building.scenarios).toHaveLength(1);
    expect(store.getState().viewScenarioId).toBeNull();
    store.getState().undo();
    expect(store.getState().building.scenarios).toHaveLength(2);
    expect(copy).not.toBe(id);
  });
});

describe("applyWallOpenings", () => {
  it("puts a photo's openings on the wall as one undo step and leaves the wall selected", async () => {
    const { planWallOpenings } = await import("@/geometry/photoWall");
    const house = exampleAltbau("en");
    store.getState().loadBuilding(house);
    const before = store.getState().building;
    const plan = planWallOpenings(
      before,
      0,
      [{ kind: "window", x: 1, y: 1, width: 1.1, height: 1.5, score: 0.9 }],
      () => ({ kind: "photo" }),
    );
    if (!plan) throw new Error("no plan");
    const steps = store.getState().past.length;
    store.getState().applyWallOpenings(plan.building, 0);
    expect(store.getState().past.length).toBe(steps + 1);
    expect(store.getState().selection).toMatchObject({ kind: "wall", wallIndex: 0 });
    expect(
      store
        .getState()
        // Interior openings number their walls separately and stay as they are.
        .building.storeys.flatMap((s) =>
          s.openings.filter((o) => !o.interior && o.wallIndex === 0),
        ),
    ).toHaveLength(1);
    store.getState().undo();
    expect(store.getState().building).toBe(before);
  });
});

describe("scenarios with a new heating system", () => {
  it("keep it when created, change and clear it, and duplicate it", () => {
    const s = () => store.getState();
    const heating = { carrier: "heatPumpAir" as const, efficiency: 3, hotWater: 12.5 };
    const id = s().addScenario("Heat pump", { overrides: {}, heating });
    const find = (x: string) => s().building.scenarios?.find((sc) => sc.id === x);
    expect(find(id)?.heating).toEqual(heating);
    s().updateScenario(id, { heating: { ...heating, efficiency: 3.5 } });
    expect(find(id)?.heating?.efficiency).toBe(3.5);
    const copy = s().addScenario("Copy", find(id));
    expect(find(copy)?.heating?.efficiency).toBe(3.5);
    s().updateScenario(id, { heating: undefined });
    expect(find(id) && "heating" in find(id)!).toBe(false);
  });
});

describe("replaceWindows", () => {
  const windows = () =>
    store
      .getState()
      .building.storeys.flatMap((s) =>
        s.openings.filter((o) => o.kind === "window").map((o) => ({ storey: s.id, ...o })),
      );

  it("reaches one window, a facade, a storey or the building, in one undo step each", () => {
    const s = () => store.getState();
    s().loadBuilding(exampleAltbau("en"));
    const all = windows();
    const exterior = all.filter((w) => !w.interior);
    const first = exterior[0];
    if (!first) throw new Error("no window");
    const before = s().building;

    s().replaceWindows({ kind: "opening", storeyId: first.storey, id: first.id }, "c_glazing_2010");
    expect(windows().filter((w) => w.constructionId === "c_glazing_2010")).toHaveLength(1);
    expect(s().building.constructions.filter((c) => c.id === "c_glazing_2010")).toHaveLength(1);

    s().replaceWindows({ kind: "wall", wallIndex: first.wallIndex }, "c_glazing_2010");
    const facade = exterior.filter((w) => w.wallIndex === first.wallIndex);
    expect(windows().filter((w) => w.constructionId === "c_glazing_2010")).toHaveLength(
      facade.length,
    );
    // Added once, not per call.
    expect(s().building.constructions.filter((c) => c.id === "c_glazing_2010")).toHaveLength(1);

    s().replaceWindows({ kind: "building" }, PRESET_IDS.glazingTriple);
    const after = windows();
    expect(
      after.filter((w) => !w.interior).every((w) => w.constructionId === PRESET_IDS.glazingTriple),
    ).toBe(true);
    // Windows in interior walls are not envelope and stay as they were.
    for (const w of after.filter((x) => x.interior)) {
      expect(w.constructionId).toBe(all.find((x) => x.id === w.id)?.constructionId);
    }
    expect(s().building.windowConstructionId).toBe(PRESET_IDS.glazingTriple);

    s().undo();
    s().undo();
    s().undo();
    expect(s().building).toBe(before);
  });

  it("names a new window type in the interface language, and renames it on a switch", () => {
    const s = () => store.getState();
    s().setLanguage("de");
    s().replaceWindows({ kind: "building" }, "c_glazing_box");
    const box = () => s().building.constructions.find((c) => c.id === "c_glazing_box");
    expect(box()?.name).toBe("Kastenfenster, zwei Einfachscheiben");
    s().setLanguage("en");
    expect(box()?.name).toBe("Box window, two single panes");
  });
});

describe("facade photos", () => {
  it("are dropped when another building loads, so none lands on its walls", () => {
    URL.revokeObjectURL = () => undefined;
    const photos = createEditorStore();
    photos.getState().setFacadePhoto(4, { url: "blob:pub", width: 10, height: 10 });
    expect(Object.keys(photos.getState().facadePhotos)).toEqual(["4"]);
    photos.getState().loadBuilding(exampleAltbau("en"));
    expect(photos.getState().facadePhotos).toEqual({});
  });
});

describe("facade colour", () => {
  it("is set from a photo, undone in one step, and cleared back to neutral", () => {
    const s = () => store.getState();
    s().setFacadeColor("#c83c32");
    expect(s().building.facadeColor).toBe("#c83c32");
    s().undo();
    expect(s().building.facadeColor).toBeUndefined();
    s().setFacadeColor("#e6be5a");
    s().setFacadeColor(null);
    expect(s().building).not.toHaveProperty("facadeColor");
  });
});

describe("a viewer or commenter", () => {
  it("changes nothing in the building, while remote changes still arrive", () => {
    const store = createEditorStore();
    store.getState().setProjectId("p1");
    store.getState().setProjectRole("viewer");
    const before = store.getState().building;
    store.getState().setWallThickness(0.5);
    expect(store.getState().building).toBe(before);
    expect(store.getState().past).toEqual([]);
    const remote = { ...before, name: "From the server" };
    store.getState().applyRemoteBuilding(remote);
    expect(store.getState().building.name).toBe("From the server");
    store.getState().setProjectRole("editor");
    store.getState().setWallThickness(0.5);
    expect(store.getState().building.wallThickness).toBe(0.5);
  });
});
