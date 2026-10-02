import { describe, expect, it, vi } from "vitest";
import { exampleHouse } from "@/lib/examples";
import { useEditorStore } from "@/store/building";
import { deleteFloorPlan } from "./deleteFloorPlan";

const removePhoto = vi.fn(() => Promise.resolve());
vi.mock("@/projects/projects", () => ({
  currentProjectRef: () => ({ kind: "server", id: "p1" }),
  removePhoto: (...args: unknown[]) => removePhoto(...(args as [])),
}));

describe("deleteFloorPlan", () => {
  it("takes the drawing off the storey and out of the project, and keeps the walls", () => {
    useEditorStore.getState().loadBuilding(exampleHouse("en"));
    const storey = useEditorStore.getState().building.storeys[0];
    if (!storey) throw new Error("no storey");
    useEditorStore
      .getState()
      .setFloorPlanImage(storey.id, { url: "blob:x", width: 10, height: 10 });
    const walls = storey.interiorWalls.length;
    deleteFloorPlan(storey.id);
    const after = useEditorStore.getState();
    expect(after.floorPlanImages[storey.id]).toBeUndefined();
    expect(after.building.storeys[0]?.interiorWalls.length).toBe(walls);
    expect(removePhoto).toHaveBeenCalledWith({ kind: "server", id: "p1" }, `plan-${storey.id}`);
  });
});
