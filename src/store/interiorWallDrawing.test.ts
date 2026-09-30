import { describe, expect, it } from "vitest";
import { effectiveWallThickness } from "@/geometry/layers";
import { drawWallTo, snapToWall } from "@/geometry/wallDrawing";
import { moveWall } from "@/geometry/wallGraph";
import { createEditorStore } from "./building";

describe("a wall drawn by hand", () => {
  it("closes rooms: drawn across a room, it splits it in two", () => {
    const store = createEditorStore();
    const { building } = store.getState();
    const storey = building.storeys[0];
    if (!storey) throw new Error("no storey");
    const ctx = {
      footprint: building.footprint,
      walls: storey.interiorWalls,
      exteriorThickness: effectiveWallThickness(building),
      thicknessOf: () => 0.1,
    };
    const before = storey.rooms.length;
    // From the middle of the first outline edge, straight into the building.
    const [a, b] = [building.footprint[0], building.footprint[1]];
    if (!a || !b) throw new Error("no outline");
    const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    const inward = { x: -(b.y - a.y), y: b.x - a.x };
    const l = Math.hypot(inward.x, inward.y);
    const into = (k: number) => ({ x: mid.x + (inward.x / l) * k, y: mid.y + (inward.y / l) * k });
    const start = snapToWall(into(ctx.exteriorThickness), ctx, 0.2);
    if (!start) throw new Error("no start");
    const draft = drawWallTo(start, into(3), ctx);
    if (!draft) throw new Error("no wall");
    store.getState().addInteriorWall(storey.id, draft.segment);
    expect(store.getState().building.storeys[0]?.rooms.length).toBe(before + 1);
  });

  it("moves a wall sideways live, and one undo takes the whole drag back", () => {
    const store = createEditorStore();
    const building = store.getState().building;
    const storeyId = building.storeys[0]?.id ?? "";
    const exteriorThickness = effectiveWallThickness(building);
    const [a, b] = [building.footprint[0], building.footprint[1]];
    if (!a || !b) throw new Error("no outline");
    // A wall straight across from the middle of the first outline edge.
    const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    const l = Math.hypot(b.x - a.x, b.y - a.y);
    const inward = { x: -(b.y - a.y) / l, y: (b.x - a.x) / l };
    const into = (k: number) => ({ x: mid.x + inward.x * k, y: mid.y + inward.y * k });
    const walls = () => store.getState().building.storeys[0]?.interiorWalls ?? [];
    const ctx = {
      footprint: building.footprint,
      walls: walls(),
      openings: [],
      exteriorThickness,
      thicknessOf: () => 0.1,
    };
    const start = snapToWall(into(exteriorThickness), ctx, 0.2);
    if (!start) throw new Error("no start");
    const draft = drawWallTo(start, into(3), ctx);
    if (!draft) throw new Error("no wall");
    store.getState().addInteriorWall(storeyId, draft.segment);
    const before = store.getState().building;
    const rooms = before.storeys[0]?.rooms.length ?? 0;
    const index = walls().length - 1;

    // A drag: several moves, each measured from the state the drag began with.
    const storey = before.storeys[0];
    if (!storey) throw new Error("no storey");
    const base = { walls: storey.interiorWalls, openings: storey.openings };
    const moveCtx = {
      footprint: building.footprint,
      exteriorThickness,
      thicknessOf: () => 0.1,
    };
    store.getState().beginBatch();
    let moved = 0;
    for (const delta of [0.2, 0.5, 0.8]) {
      const edit = moveWall(index, delta, base, moveCtx);
      if (edit) {
        store.getState().applyWallEdit(storeyId, edit);
        moved++;
      }
    }
    store.getState().endBatch();
    expect(moved).toBe(3);
    expect(store.getState().building.storeys[0]?.rooms).toHaveLength(rooms);
    store.getState().undo();
    expect(store.getState().building).toEqual(before);
  });
});
