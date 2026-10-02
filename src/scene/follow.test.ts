import { beforeEach, describe, expect, it } from "vitest";
import { exampleHouse } from "@/lib/examples";
import { resetIds } from "@/lib/ids";
import { useEditorStore } from "@/store/building";
import type { Presence, Selection } from "@/store/building";
import { RESEND_MS, cursorHeight, followView, shouldShare } from "./follow";
import { remoteSelectionColor } from "./hover";

const view = {
  position: [10, 12, 10] as [number, number, number],
  target: [0, 1, 0] as [number, number, number],
  storeyId: "s1",
  plan: false,
  zoom: null,
};

describe("sharing the view", () => {
  it("sends a change at once, and the same view again only after a while", () => {
    const sent = { view, at: 1000 };
    expect(shouldShare(sent, view, 1200)).toBe(false);
    // Someone who just started following gets it without waiting for a move.
    expect(shouldShare(sent, view, 1000 + RESEND_MS)).toBe(true);
    expect(shouldShare(sent, { ...view, plan: true, zoom: 40 }, 1200)).toBe(true);
    expect(shouldShare(sent, { ...view, storeyId: "s2" }, 1200)).toBe(true);
    expect(shouldShare(sent, { ...view, position: [10, 12, 10.5] }, 1200)).toBe(true);
    expect(shouldShare({ view: null, at: 0 }, view, 0)).toBe(true);
  });
});

describe("following", () => {
  beforeEach(() => {
    resetIds();
    useEditorStore.getState().loadBuilding(exampleHouse("en"));
    useEditorStore.getState().setPlanView(false);
  });

  it("takes over the followed person's storey and view mode", () => {
    const [ground, upper] = useEditorStore.getState().building.storeys;
    if (!ground || !upper) throw new Error("fixture");
    useEditorStore.getState().setActiveStorey(ground.id);
    followView({ ...view, storeyId: upper.id, plan: true, zoom: 40 });
    expect(useEditorStore.getState().activeStoreyId).toBe(upper.id);
    expect(useEditorStore.getState().planView).toBe(true);
    followView({ ...view, storeyId: upper.id, plan: false });
    expect(useEditorStore.getState().planView).toBe(false);
  });

  it("draws a pointer on the floor of the storey its person is on", () => {
    const building = useEditorStore.getState().building;
    const [ground, upper] = building.storeys;
    if (!ground || !upper) throw new Error("fixture");
    expect(cursorHeight(building, ground.id)).toBe(0);
    expect(cursorHeight(building, upper.id)).toBe(ground.height);
    expect(cursorHeight(building, null)).toBe(0);
    expect(cursorHeight(building, "gone")).toBe(0);
  });
});

describe("someone else's selection", () => {
  const wall: Selection = { kind: "wall", storeyId: "s1", wallIndex: 2 };
  const tab = (clientId: string, userId: string, color: string): Presence => ({
    clientId,
    actor: clientId,
    color,
    selection: wall,
    userId,
  });

  it("tints in the other person's colour, never in one's own from a second tab", () => {
    const mine = tab("my-other-tab", "me", "#e76f51");
    const theirs = tab("their-tab", "them", "#6c8ef5");
    expect(remoteSelectionColor([mine], wall, "me")).toBeNull();
    expect(remoteSelectionColor([mine, theirs], wall, "me")).toBe("#6c8ef5");
    expect(remoteSelectionColor([theirs], { ...wall, wallIndex: 3 }, "me")).toBeNull();
  });
});
