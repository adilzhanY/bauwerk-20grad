import { describe, expect, it } from "vitest";
import { exampleHouse } from "@/lib/examples";
import { resetIds } from "@/lib/ids";
import { createEditorStore } from "@/store/building";
import { diffBuilding } from "./ops";
import { mergeSummaries, summarizeOps } from "./summary";

describe("change summaries", () => {
  it("count the doors added, the window moved many times as one, and the walls redrawn", () => {
    resetIds();
    const store = createEditorStore();
    store.getState().loadBuilding(exampleHouse("en"));
    const before = store.getState().building;
    const ground = before.storeys[0];
    if (!ground) throw new Error("fixture");
    const window = ground.openings.find((o) => o.kind === "window");
    if (!window) throw new Error("fixture");
    for (const offset of [0.5, 0.6, 0.7])
      store.getState().updateOpening(ground.id, window.id, { offset });
    store.getState().addOpening(ground.id, {
      kind: "door",
      wallIndex: 1,
      offset: 1,
      width: 1,
      height: 2.1,
      sill: 0,
    });
    store.getState().addInteriorWall(ground.id, { a: { x: 1, y: 0 }, b: { x: 1, y: 3 } });
    const summary = summarizeOps(diffBuilding(before, store.getState().building));
    expect(summary.doors).toEqual({ added: 1, removed: 0, changed: 0 });
    expect(summary.openings).toEqual({ added: 0, removed: 0, changed: 1 });
    expect(summary.walls?.changed).toBe(1);
  });

  it("merge kind by kind", () => {
    expect(
      mergeSummaries(
        { roof: { added: 0, removed: 0, changed: 1 } },
        {
          roof: { added: 0, removed: 0, changed: 2 },
          scenarios: { added: 1, removed: 0, changed: 0 },
        },
      ),
    ).toEqual({
      roof: { added: 0, removed: 0, changed: 3 },
      scenarios: { added: 1, removed: 0, changed: 0 },
    });
  });
});
