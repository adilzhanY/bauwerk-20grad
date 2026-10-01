import { beforeEach, describe, expect, it } from "vitest";
import { createEditorStore } from "@/store/building";
import type { EditorStore } from "@/store/building";
import type { Building } from "@/geometry/types";
import { resetIds } from "@/lib/ids";
import { example } from "@/lib/examples";
import type { ExampleId } from "@/lib/examples";
import { applyOps, diffBuilding, parseOps, sameJson, valueAt } from "./ops";
import type { Op } from "./ops";

/** The diff replays exactly: applying it to `prev` gives `next`, and nothing is dropped. */
function expectRoundTrip(prev: Building, next: Building) {
  const ops = diffBuilding(prev, next);
  const { value, dropped } = applyOps(prev, ops);
  expect(dropped).toEqual([]);
  expect(sameJson(value, next)).toBe(true);
  // Ops travel as JSON; they must survive it.
  const wire = JSON.parse(JSON.stringify(ops)) as Op[];
  expect(sameJson(applyOps(prev, wire).value, next)).toBe(true);
}

describe("diffBuilding and applyOps", () => {
  beforeEach(() => {
    resetIds();
  });

  it("round-trips every step of a real editing session through the store", () => {
    const store = createEditorStore();
    const s = () => store.getState();
    const storey = () => s().building.storeys[0]?.id ?? "";
    const steps: ((st: EditorStore) => void)[] = [
      (st) => {
        st.setFootprintVertex(1, { x: 12, y: 0 });
      },
      (st) => {
        st.insertFootprintVertex(0);
      },
      (st) => {
        st.addStorey();
      },
      (st) => {
        st.renameStorey(storey(), "Keller");
      },
      (st) => {
        st.setStoreyHeight(storey(), 2.7);
      },
      (st) => {
        st.addOpening(storey(), {
          kind: "window",
          wallIndex: 0,
          offset: 1,
          width: 1.2,
          height: 1.4,
          sill: 0.9,
        });
      },
      (st) => {
        st.addOpening(storey(), {
          kind: "door",
          wallIndex: 1,
          offset: 0.5,
          width: 1,
          height: 2.1,
          sill: 0,
        });
      },
      (st) => {
        const id = s().building.storeys[0]?.openings[0]?.id ?? "";
        st.updateOpening(storey(), id, { offset: 2.5 });
      },
      (st) => {
        st.addInteriorWall(storey(), { a: { x: 5, y: 0 }, b: { x: 5, y: 8 } });
      },
      (st) => {
        const room = s().building.storeys[0]?.rooms[0]?.id ?? "";
        st.renameRoom(storey(), room, "Kitchen");
      },
      (st) => {
        const zone = st.addZone("Heated", "#e76f51", true);
        const room = s().building.storeys[0]?.rooms[0]?.id ?? "";
        st.assignRoomToZone(storey(), room, zone);
      },
      (st) => {
        const wall = s().building.wallConstructionId;
        st.addLayer(wall);
      },
      (st) => {
        const wall = s().building.constructions.find(
          (c) => c.id === s().building.wallConstructionId,
        );
        const layer = wall?.layers?.at(-1)?.id ?? "";
        st.moveLayer(wall?.id ?? "", layer, -1);
      },
      (st) => {
        st.setRoof({ kind: "gable", pitch: 35 });
      },
      (st) => {
        st.setEdgeShared(2, true);
      },
      (st) => {
        st.setOrigin({ lat: 52.5, lon: 13.4, rotation: 0 });
      },
      (st) => {
        st.addScenario("Envelope");
      },
      (st) => {
        st.moveStorey(storey(), 1);
      },
      (st) => {
        st.duplicateStorey(storey());
      },
      (st) => {
        st.translateBuilding({ x: 1, y: 2 });
      },
      (st) => {
        st.rotateBuilding(15);
      },
      (st) => {
        st.setOrigin(undefined);
      },
      (st) => {
        const id = s().building.storeys[0]?.openings[0]?.id ?? "";
        st.removeOpening(storey(), id);
      },
      (st) => {
        st.removeStorey(s().building.storeys[1]?.id ?? "");
      },
      (st) => {
        st.undo();
      },
      (st) => {
        st.redo();
      },
    ];
    for (const step of steps) {
      const before = s().building;
      step(s());
      const after = s().building;
      expect(after).not.toBe(before);
      expectRoundTrip(before, after);
    }
  });

  it("round-trips between every pair of example buildings", () => {
    const ids: ExampleId[] = ["house", "block", "altbau", "tower"];
    const buildings = ids.flatMap((id) => [example(id, "en"), example(id, "de")]);
    for (const a of buildings) for (const b of buildings) expectRoundTrip(a, b);
  });

  it("returns nothing for equal buildings, and keeps untouched parts by reference", () => {
    const building = example("altbau", "en");
    expect(diffBuilding(building, structuredClone(building))).toEqual([]);
    const storey = building.storeys[1];
    const opening = storey?.openings[0];
    if (!storey || !opening) throw new Error("fixture");
    const next: Building = {
      ...building,
      storeys: building.storeys.map((s) =>
        s === storey
          ? {
              ...s,
              openings: s.openings.map((o) => (o === opening ? { ...o, width: 1.5 } : o)),
            }
          : s,
      ),
    };
    const ops = diffBuilding(building, next);
    expect(ops).toEqual([
      {
        op: "set",
        path: ["storeys", { id: storey.id }, "openings", { id: opening.id }, "width"],
        value: 1.5,
      },
    ]);
    const { value } = applyOps(building, ops);
    expect(value.storeys[0]).toBe(building.storeys[0]);
    expect(value.zones).toBe(building.zones);
    expect(valueAt(value, ops[0]?.path ?? [])).toBe(1.5);
  });
});

describe("merging concurrent edits", () => {
  const base = () => example("house", "en");
  const firstStorey = (b: Building) =>
    b.storeys[0] ??
    (() => {
      throw new Error("fixture");
    })();

  /** One user's change as ops, taken against the shared base. */
  function edit(b: Building, change: (draft: Building) => void): Op[] {
    const draft = structuredClone(b);
    change(draft);
    return diffBuilding(b, draft);
  }

  it("keeps two edits to different openings", () => {
    const b = base();
    const [o1, o2] = firstStorey(b).openings;
    if (!o1 || !o2) throw new Error("fixture");
    const alice = edit(b, (d) => {
      const o = firstStorey(d).openings[0];
      if (o) o.offset += 1;
    });
    const bob = edit(b, (d) => {
      const o = firstStorey(d).openings[1];
      if (o) o.width = 0.8;
    });
    const merged = applyOps(applyOps(b, alice).value, bob).value;
    expect(firstStorey(merged).openings[0]?.offset).toBe(o1.offset + 1);
    expect(firstStorey(merged).openings[1]?.width).toBe(0.8);
  });

  it("keeps the later of two edits to the same field, and both edits to different fields", () => {
    const b = base();
    const alice = edit(b, (d) => {
      const o = firstStorey(d).openings[0];
      if (o) {
        o.offset = 1;
        o.height = 1.1;
      }
    });
    const bob = edit(b, (d) => {
      const o = firstStorey(d).openings[0];
      if (o) {
        o.offset = 2;
        o.sill = 0.5;
      }
    });
    const o = firstStorey(applyOps(applyOps(b, alice).value, bob).value).openings[0];
    expect(o).toMatchObject({ offset: 2, height: 1.1, sill: 0.5 });
  });

  it("drops an edit to an opening someone else deleted, and reports it", () => {
    const b = base();
    const target = firstStorey(b).openings[0];
    if (!target) throw new Error("fixture");
    const alice = edit(b, (d) => {
      firstStorey(d).openings.splice(0, 1);
    });
    const bob = edit(b, (d) => {
      const o = firstStorey(d).openings[0];
      if (o) o.width = 2;
    });
    const { value, dropped } = applyOps(applyOps(b, alice).value, bob);
    expect(firstStorey(value).openings.some((o) => o.id === target.id)).toBe(false);
    expect(dropped).toHaveLength(1);
  });

  it("keeps openings two people add at the same time", () => {
    const b = base();
    const template = firstStorey(b).openings[0];
    if (!template) throw new Error("fixture");
    const alice = edit(b, (d) => {
      firstStorey(d).openings.push({ ...template, id: "a-new", offset: 0.1 });
    });
    const bob = edit(b, (d) => {
      firstStorey(d).openings.push({ ...template, id: "b-new", offset: 0.2 });
    });
    const ids = firstStorey(applyOps(applyOps(b, alice).value, bob).value).openings.map(
      (o) => o.id,
    );
    expect(ids).toContain("a-new");
    expect(ids).toContain("b-new");
    expect(ids).toHaveLength(firstStorey(b).openings.length + 2);
  });

  it("does not insert the same item twice", () => {
    const b = base();
    const ops = edit(b, (d) => {
      d.zones.push({
        id: "z-new",
        name: "Cellar",
        color: "#123456",
        heated: false,
        temperature: 10,
      });
    });
    const once = applyOps(b, ops).value;
    const twice = applyOps(once, ops);
    expect(twice.value.zones.filter((z) => z.id === "z-new")).toHaveLength(1);
    expect(twice.dropped).toHaveLength(1);
  });
});

describe("parseOps", () => {
  it("accepts what diffBuilding produces, after a trip through JSON", () => {
    const ops = diffBuilding(example("house", "en"), example("altbau", "de"));
    expect(parseOps(JSON.parse(JSON.stringify(ops)))).toHaveLength(ops.length);
  });

  it("rejects malformed batches and paths into the prototype", () => {
    for (const bad of [
      null,
      {},
      [{ op: "set", path: ["name"] }],
      [{ op: "move", path: [] }],
      [{ op: "set", path: [{ id: 1 }], value: 1 }],
      [{ op: "set", path: ["__proto__", "polluted"], value: true }],
      [{ op: "insert", path: ["zones"], value: { name: "no id" }, after: null }],
      [{ op: "order", path: ["zones"], ids: [1, 2] }],
    ]) {
      expect(parseOps(bad)).toBeNull();
    }
  });
});

describe("ops edge cases", () => {
  it("replaces an array with a duplicated id whole, so the change lands on the right item", () => {
    const prev = {
      xs: [
        { id: "a", v: 1 },
        { id: "a", v: 2 },
      ],
    };
    const next = {
      xs: [
        { id: "a", v: 1 },
        { id: "a", v: 3 },
      ],
    };
    expect(applyOps(prev, diffBuilding(prev, next)).value).toEqual(next);
  });

  it("orders known ids and keeps unknown ones after them", () => {
    const value = { xs: [{ id: "a" }, { id: "b" }, { id: "c" }] };
    const { value: out } = applyOps(value, [{ op: "order", path: ["xs"], ids: ["c", "x", "a"] }]);
    expect(out.xs.map((x) => x.id)).toEqual(["c", "a", "b"]);
  });

  it("drops a path through an inherited key instead of walking into the prototype", () => {
    const { value, dropped } = applyOps({ a: 1 }, [
      { op: "set", path: ["toString", "x"], value: 1 },
    ]);
    expect(value).toEqual({ a: 1 });
    expect(dropped).toHaveLength(1);
  });
});
