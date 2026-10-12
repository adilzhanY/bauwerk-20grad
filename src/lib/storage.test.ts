import { beforeEach, describe, expect, it } from "vitest";
import { fromJson, toJson } from "@/geometry/export";
import { exampleHouse } from "@/lib/examples";
import { resetIds } from "@/lib/ids";
import {
  initialBuilding,
  listProjectCopies,
  loadProjectCopy,
  rememberOpenProject,
  saveProjectCopy,
} from "@/lib/storage";

describe("saved projects", () => {
  beforeEach(() => {
    resetIds();
    localStorage.clear();
  });

  it("keeps a project the editor allowed but the import check refuses, after a reload", () => {
    const house = exampleHouse("en");
    const ground = house.storeys[0];
    const window = ground?.openings[0];
    if (!ground || !window) throw new Error("fixture");
    // A footprint corner moved so a window now sits past the end of its wall: the editor
    // only warns about it.
    const building = {
      ...house,
      project: { localId: "p1" },
      storeys: [
        { ...ground, openings: [{ ...window, offset: 500 }, ...ground.openings.slice(1)] },
        ...house.storeys.slice(1),
      ],
    };
    expect(fromJson(toJson(building)).ok).toBe(false);
    saveProjectCopy(building);
    rememberOpenProject("p1");
    expect(listProjectCopies()).toHaveLength(1);
    expect(loadProjectCopy("p1")?.storeys[0]?.openings[0]?.offset).toBe(500);
    expect(initialBuilding()?.project?.localId).toBe("p1");
  });

  it("still skips a file that is not a building", () => {
    localStorage.setItem("bauwerk.project.p1", JSON.stringify({ format: "bauwerk", version: 1 }));
    localStorage.setItem("bauwerk.project.p2", "{broken");
    expect(listProjectCopies()).toEqual([]);
  });
});
