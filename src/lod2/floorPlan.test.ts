import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { PRESET_IDS } from "@/geometry/constructions";
import { floorPlanEdits } from "@/geometry/floorPlanImport";
import type { PlanDoor, PlanWall } from "@/geometry/floorPlanImport";
import { validateOpening, openingsOn } from "@/geometry/openings";
import { centroid, distance } from "@/geometry/polygon";
import { createEditorStore } from "@/store/building";
import { analyzePart } from "./analysis";
import { loadFixture, surveyFromFixture } from "./testFixtures";

/** What lod2-floorplan returned for the ground floor plan of BOo (lod2/sample-plans/). */
const plan = JSON.parse(
  readFileSync(join(__dirname, "../../lod2/sample-plans/DEBE02YY40000BOo-EG.walls.json"), "utf8"),
) as {
  walls: { a: number[]; b: number[]; thickness: number }[];
  doors: { a: number[]; b: number[] }[];
};
const xy = (p: number[]) => ({ x: p[0] ?? 0, y: p[1] ?? 0 });

describe("the ground floor plan of BOo in the editor", () => {
  it("builds its rooms and doors on the ground floor, in one undo step", () => {
    const { detail, survey, neighbours } = loadFixture("DEBE02YY40000BOo");
    const result = analyzePart(
      detail,
      "DEBE02YY40000BOo",
      surveyFromFixture(survey),
      neighbours,
      "en",
    );
    if (!result.ok) throw new Error("analysis failed");
    const store = createEditorStore();
    store.getState().loadBuilding(result.analysis.building);
    const ground = store.getState().building.storeys[0];
    if (!ground) throw new Error("no ground floor");
    const before = store.getState().building;

    const walls: PlanWall[] = plan.walls.map((w) => ({
      a: xy(w.a),
      b: xy(w.b),
      thickness: w.thickness,
    }));
    const doors: PlanDoor[] = plan.doors.map((d) => ({ a: xy(d.a), b: xy(d.b) }));
    const edits = floorPlanEdits(
      walls,
      doors,
      before.footprint,
      ground.height,
      before.constructions,
    );
    store.getState().applyFloorPlan(ground.id, edits);

    const storey = store.getState().building.storeys[0];
    if (!storey) throw new Error("no ground floor");
    // The plan's 6 walls, as 13 walls from joint to joint.
    expect(storey.interiorWalls).toHaveLength(13);
    // Treppe and Diele, the two Zimmer, the big room, the hall, Contor, Vorraum, Eingang.
    expect(storey.rooms).toHaveLength(8);
    // The long middle wall and the cross wall are drawn thick: load-bearing brick, 24 cm; the
    // rest are partitions.
    const typeOf = (x: number, y: number) =>
      storey.interiorWalls.find(
        (w) => distance(w.a, { x, y }) + distance({ x, y }, w.b) - distance(w.a, w.b) < 0.01,
      )?.constructionId;
    expect(typeOf(0, 2.235)).toBe(PRESET_IDS.interiorBearing24);
    expect(typeOf(-2.185, -5)).toBe(PRESET_IDS.interiorBearing24);
    expect(typeOf(0, 3.66)).toBe(PRESET_IDS.interiorPartition);
    for (const room of storey.rooms) expect(room.area).toBeGreaterThan(2);
    const doorsIn = storey.openings.filter((o) => o.interior);
    expect(doorsIn).toHaveLength(8);
    for (const door of doorsIn) {
      const wall = storey.interiorWalls[door.wallIndex];
      if (!wall) throw new Error("door on a wall that does not exist");
      const siblings = openingsOn(storey.openings, door.wallIndex, true);
      expect(
        validateOpening(door, {
          wallLength: distance(wall.a, wall.b),
          storeyHeight: storey.height,
          siblings,
        }),
      ).toEqual([]);
    }
    // The windows measured from the facade photo stay where they were.
    expect(storey.openings.filter((o) => !o.interior)).toEqual(
      ground.openings.filter((o) => !o.interior),
    );

    store.getState().undo();
    expect(store.getState().building).toEqual(before);

    // A name read inside a room names it, in the same undo step; the others keep "Room n".
    const inside = centroid(storey.rooms[0]?.polygon ?? []);
    store.getState().applyFloorPlan(ground.id, {
      ...edits,
      roomNames: [{ at: inside, name: "Contor", score: 2 }],
    });
    const named = store.getState().building.storeys[0]?.rooms ?? [];
    expect(named.filter((r) => r.name === "Contor")).toHaveLength(1);
    expect(named.filter((r) => /^Room \d+$/.test(r.name))).toHaveLength(7);

    // Deleting the plan with its walls and doors: one room in the outline again, the windows
    // stay, and one undo brings the walls back.
    const read = store.getState().building;
    store.getState().clearInteriors(ground.id);
    const cleared = store.getState().building.storeys[0];
    expect(cleared?.interiorWalls).toHaveLength(0);
    expect(cleared?.openings.filter((o) => o.interior)).toHaveLength(0);
    expect(cleared?.openings.filter((o) => !o.interior)).toEqual(
      ground.openings.filter((o) => !o.interior),
    );
    expect(cleared?.rooms).toHaveLength(1);
    store.getState().undo();
    expect(store.getState().building).toEqual(read);
    store.getState().undo();
    expect(store.getState().building).toEqual(before);
  });
});
