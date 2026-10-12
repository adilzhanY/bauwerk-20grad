import { beforeEach, describe, expect, it } from "vitest";
import { resetIds } from "@/lib/ids";
import { createEditorStore } from "./building";
import {
  selectActiveStorey,
  selectTotalFloorArea,
  selectTotalHeight,
  storeyElevation,
} from "./selectors";

let store: ReturnType<typeof createEditorStore>;
beforeEach(() => {
  resetIds();
  store = createEditorStore();
});

describe("selectors", () => {
  it("report the active storey, elevation and totals", () => {
    store.getState().addStorey();
    store.getState().setStoreyHeight(store.getState().activeStoreyId ?? "", 2.5);
    const s = store.getState();
    const [ground, first] = s.building.storeys;
    expect(selectActiveStorey(s)?.id).toBe(first?.id);
    expect(storeyElevation(s.building, ground?.id ?? "")).toBe(0);
    expect(storeyElevation(s.building, first?.id ?? "")).toBe(3);
    expect(storeyElevation(s.building, "missing")).toBe(5.5);
    expect(selectTotalHeight(s)).toBe(5.5);
    expect(selectTotalFloorArea(s)).toBeCloseTo(160);
  });
});
