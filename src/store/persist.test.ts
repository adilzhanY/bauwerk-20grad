import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { exampleHouse } from "@/lib/examples";
import { resetIds } from "@/lib/ids";
import { initialBuilding, listProjectCopies, loadLanguage, loadProjectCopy } from "@/lib/storage";
import { createEditorStore } from "./building";
import { startPersistence } from "./persist";

describe("persistence", () => {
  beforeEach(() => {
    resetIds();
    localStorage.clear();
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("saves the language at once", () => {
    const store = createEditorStore();
    startPersistence(store);
    store.getState().setLanguage("de");
    expect(loadLanguage()).toBe("de");
  });

  it("keeps nothing of a building that was never saved as a project", () => {
    const store = createEditorStore();
    startPersistence(store);
    store.getState().setWallThickness(0.45);
    store.getState().setProjectInfo({ client: "WEG" });
    vi.advanceTimersByTime(400);
    expect(listProjectCopies()).toEqual([]);
    expect(initialBuilding()).toBeNull();
  });

  it("keeps every change of a saved project, and reopens it after a reload", () => {
    const store = createEditorStore();
    const stop = startPersistence(store);
    store.getState().setProjectInfo({ localId: "p1" });
    store.getState().setWallThickness(0.42);
    vi.advanceTimersByTime(400);
    expect(loadProjectCopy("p1")?.wallThickness).toBe(0.42);
    expect(initialBuilding()?.project?.localId).toBe("p1");

    stop();
    store.getState().setWallThickness(0.5);
    vi.advanceTimersByTime(400);
    expect(loadProjectCopy("p1")?.wallThickness).toBe(0.42);
  });

  it("drops the old autosaves and turns an old project copy into a saved project", () => {
    localStorage.setItem("bauwerk.building", "{broken");
    const file = (building: object) =>
      JSON.stringify({ format: "bauwerk", version: 1, building, savedAt: "2026-09-01T00:00:00Z" });
    localStorage.setItem("bauwerk.building.lod2-A", file(exampleHouse("en")));
    localStorage.setItem(
      "bauwerk.building.lod2-B",
      file({ ...exampleHouse("en"), project: { client: "WEG" } }),
    );
    expect(initialBuilding()).toBeNull();
    expect(localStorage.getItem("bauwerk.building")).toBeNull();
    expect(localStorage.getItem("bauwerk.building.lod2-A")).toBeNull();
    const projects = listProjectCopies();
    expect(projects).toHaveLength(1);
    expect(projects[0]?.building.project?.client).toBe("WEG");
    expect(projects[0]?.building.project?.localId).toBeTruthy();
  });
});
