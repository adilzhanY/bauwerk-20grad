import { describe, expect, it } from "vitest";
import { createEditorStore } from "@/store/building";

describe("history", () => {
  it("clearHistory ends a gesture that was never ended, so later edits are undo steps again", () => {
    const store = createEditorStore();
    store.getState().beginBatch();
    store.getState().renameBuilding("Dragging");
    // The handle unmounted mid drag; another project opens.
    store.getState().clearHistory();
    store.getState().renameBuilding("One");
    store.getState().renameBuilding("Two");
    expect(store.getState().past).toHaveLength(2);
  });
});
