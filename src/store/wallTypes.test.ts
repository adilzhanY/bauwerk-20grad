import { describe, expect, it } from "vitest";
import { PRESET_IDS } from "@/geometry/constructions";
import { computeEnergy } from "@/geometry/energy";
import { bounds } from "@/geometry/polygon";
import { createEditorStore } from "./building";

describe("interior wall types in the editor", () => {
  it("are set wall by wall, one undo step each, and change the heat lost to a cold room", () => {
    const store = createEditorStore();
    const s = () => store.getState();
    const storeyId = s().building.storeys[0]?.id ?? "";
    const { min, max } = bounds(s().building.footprint);
    const x = (min.x + max.x) / 2;
    s().addInteriorWall(storeyId, { a: { x, y: min.y }, b: { x, y: max.y } });
    const rooms = s().building.storeys[0]?.rooms ?? [];
    expect(rooms).toHaveLength(2);
    const cold = s().addZone("Cold", "#888888", false);
    s().assignRoomToZone(storeyId, rooms[0]?.id ?? "", cold);

    const before = computeEnergy(s().building).transmissionLoss;
    s().setInteriorWallType(storeyId, 0, PRESET_IDS.interiorDrywall);
    expect(s().building.storeys[0]?.interiorWalls[0]?.constructionId).toBe(
      PRESET_IDS.interiorDrywall,
    );
    expect(computeEnergy(s().building).transmissionLoss).toBeLessThan(before);

    // Not a wall type: nothing changes.
    s().setInteriorWallType(storeyId, 0, PRESET_IDS.wallBrick);
    expect(s().building.storeys[0]?.interiorWalls[0]?.constructionId).toBe(
      PRESET_IDS.interiorDrywall,
    );
    s().undo();
    expect(s().building.storeys[0]?.interiorWalls[0]?.constructionId).toBeUndefined();
  });

  it("gives a building from before wall types the presets when it is loaded", () => {
    const store = createEditorStore();
    const old = store.getState().building;
    store.getState().loadBuilding({
      ...old,
      constructions: old.constructions.filter((c) => c.category !== "interiorWall"),
    });
    expect(
      store.getState().building.constructions.filter((c) => c.category === "interiorWall"),
    ).toHaveLength(4);
  });
});
