import { describe, expect, it } from "vitest";
import { validateBuilding } from "@/geometry/export";
import type { Building } from "@/geometry/types";
import { analyzePart } from "./analysis";
import { surveyedEdge, takeOverWall } from "./applyWall";
import { loadFixture, surveyFromFixture } from "./testFixtures";

/** The Atr house as the building page computes it from its photographed street wall. */
function surveyed() {
  const { detail, survey, neighbours } = loadFixture("DEBE02YY40000Atr");
  const result = analyzePart(detail, survey.partGid, surveyFromFixture(survey), neighbours, "en");
  if (!result.ok) throw new Error(result.reason);
  return { building: result.analysis.building, surfaceIndex: survey.surfaceIndex };
}

const onEdge = (b: Building, edge: number) =>
  b.storeys.flatMap((s) => s.openings.filter((o) => !o.interior && o.wallIndex === edge));

describe("takeOverWall", () => {
  it("gives an editor without this building the whole surveyed building", () => {
    const { building, surfaceIndex } = surveyed();
    const taken = takeOverWall(null, building, surfaceIndex);
    expect(taken?.merged).toBe(false);
    expect(taken?.building).toBe(building);
    expect(taken?.edge).toBe(surveyedEdge(building, surfaceIndex));
  });

  it("replaces only the photographed wall's openings in the editor's own, edited building", () => {
    const { building, surfaceIndex } = surveyed();
    const edge = surveyedEdge(building, surfaceIndex);
    if (edge === null) throw new Error("the fixture wall has openings");
    // The consultant renamed the house and removed the photo's openings in the editor.
    const edited: Building = {
      ...building,
      name: "Edited",
      storeys: building.storeys.map((s) => ({
        ...s,
        openings: s.openings.filter((o) => o.wallIndex !== edge),
      })),
    };
    const taken = takeOverWall(edited, building, surfaceIndex);
    if (!taken) throw new Error("no takeover");
    expect(taken.merged).toBe(true);
    expect(taken.building.name).toBe("Edited");
    expect(onEdge(taken.building, edge)).toEqual(onEdge(building, edge));
    // Every other wall is exactly as the consultant left it.
    for (const other of building.footprint.keys()) {
      if (other !== edge) expect(onEdge(taken.building, other)).toEqual(onEdge(edited, other));
    }
    const id = onEdge(building, edge)[0]?.id ?? "";
    expect(taken.building.sources?.[`opening:${id}`]?.kind).toBe("photo");
    expect(validateBuilding(taken.building)).toBeNull();
  });

  it("does nothing for a wall without openings", () => {
    const { building } = surveyed();
    expect(takeOverWall(null, building, 999)).toBeNull();
  });
});
