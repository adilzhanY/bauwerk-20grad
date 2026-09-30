import { describe, expect, it } from "vitest";
import { fromJson, toJson } from "@/geometry/export";
import { createEditorStore } from "./building";

describe("measurements", () => {
  it("are kept on the storey, selected, deleted and brought back by undo", () => {
    const store = createEditorStore();
    const storeyId = store.getState().building.storeys[0]?.id ?? "";
    const id = store.getState().addMeasurement(storeyId, { x: -3, y: 1 }, { x: 4, y: 1 });
    const kept = () => store.getState().building.storeys[0]?.measurements ?? [];
    expect(kept()).toEqual([{ id, a: { x: -3, y: 1 }, b: { x: 4, y: 1 } }]);
    // The underlay's scale reads the last one measured.
    expect(store.getState().measurement).toEqual({ a: { x: -3, y: 1 }, b: { x: 4, y: 1 } });

    store.getState().select({ kind: "measurement", storeyId, id });
    store.getState().deleteSelection();
    expect(kept()).toEqual([]);
    expect(store.getState().selection).toBeNull();
    store.getState().undo();
    expect(kept().map((m) => m.id)).toEqual([id]);
  });

  it("travel with the building file", () => {
    const store = createEditorStore();
    const storeyId = store.getState().building.storeys[0]?.id ?? "";
    store.getState().addMeasurement(storeyId, { x: 0, y: 0 }, { x: 2.5, y: 0 });
    const back = fromJson(toJson(store.getState().building));
    if (!back.ok) throw new Error(back.error.code);
    expect(back.building.storeys[0]?.measurements?.[0]?.b).toEqual({ x: 2.5, y: 0 });
  });
});
