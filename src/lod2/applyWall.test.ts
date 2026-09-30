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

describe("takeOverWall and guessed windows", () => {
  it("drops the windows an older version guessed on unphotographed walls, keeps drawn ones", () => {
    const { building, surfaceIndex } = surveyed();
    const edge = surveyedEdge(building, surfaceIndex);
    if (edge === null) throw new Error("the fixture wall has openings");
    const other = (edge + 1) % building.footprint.length;
    const first = building.storeys[0];
    if (!first) throw new Error("fixture");
    // The editor still holds the building from before: a guessed window on another wall, and
    // a window the consultant drew there himself.
    const guessed = {
      id: "c9-s0-0",
      wallIndex: other,
      kind: "window" as const,
      offset: 0.5,
      width: 1,
      height: 1.2,
      sill: 0.9,
      constructionId: building.windowConstructionId,
    };
    const drawn = { ...guessed, id: "drawn-1", offset: 3 };
    const old: Building = {
      ...building,
      storeys: building.storeys.map((s, i) =>
        i === 0 ? { ...s, openings: [...s.openings, guessed, drawn] } : s,
      ),
      sources: {
        ...building.sources,
        [`opening:${guessed.id}`]: { kind: "catalogue", note: "no photo" },
      },
    };
    const taken = takeOverWall(old, building, surfaceIndex);
    expect(taken?.merged).toBe(true);
    const ids = taken?.building.storeys.flatMap((s) => s.openings.map((o) => o.id)) ?? [];
    expect(ids).not.toContain("c9-s0-0");
    expect(ids).toContain("drawn-1");
    expect(taken?.building.sources?.["opening:c9-s0-0"]).toBeUndefined();
  });
});
