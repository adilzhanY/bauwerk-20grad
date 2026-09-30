import { describe, expect, it } from "vitest";
import { sourceRows } from "@/geometry/sources";
import { analyzePart, partsWithGeometry } from "./analysis";
import type { BuildingSurvey } from "./state/survey";
import { loadFixture as load, surveyFromFixture as surveyOf } from "./testFixtures";

describe("building page analysis", () => {
  it("computes the energy of BOo from its photographed street wall, with no guessed windows", () => {
    const { detail, survey, neighbours } = load("DEBE02YY40000BOo");
    const surveyed: BuildingSurvey = {
      facts: { ageClass: "bis1918", ageClassConfirmed: false },
      walls: {
        [`${survey.partGid}:${String(survey.surfaceIndex)}`]: {
          partGid: survey.partGid,
          surfaceIndex: survey.surfaceIndex,
          openings: survey.openings,
          photo: survey.photo,
          method: "detected",
          updatedAt: 0,
        },
      },
    };
    const result = analyzePart(detail, survey.partGid, surveyed, neighbours, "de");
    if (!result.ok) throw new Error(result.reason);
    const { energy, heatLoad, pv, report, building } = result.analysis;
    expect(energy.heated).toBe(true);
    expect(energy.specificHeatingDemand).toBeGreaterThan(100);
    expect(energy.specificHeatingDemand).toBeLessThan(260);
    expect(energy.sharedWallArea).toBeGreaterThan(0);
    expect(heatLoad).toBeGreaterThan(10_000);
    expect(pv.peakPower).toBeGreaterThan(0);
    expect(report.catalogueOpenings).toBe(0);
    expect(building.sources?.storeys?.kind).toBe("photo");
  });

  it.each(["DEBE02YY40000BOo", "DEBE02YY40000Atr", "DEBE02YY400000kY"])(
    "puts openings on %s only where the photo shows them, on its one photographed wall",
    (gid) => {
      const { detail, survey, neighbours } = load(gid);
      const result = analyzePart(detail, survey.partGid, surveyOf(survey), neighbours, "de");
      if (!result.ok) throw new Error(result.reason);
      const { building } = result.analysis;
      const openings = building.storeys.flatMap((s) => s.openings);
      expect(openings.length).toBeGreaterThan(0);
      // Every opening came from the photo, and all of them sit on the same wall.
      for (const o of openings) expect(building.sources?.[`opening:${o.id}`]?.kind).toBe("photo");
      expect(new Set(openings.map((o) => o.wallIndex)).size).toBe(1);
    },
  );

  it.each(["DEBE02YY40000BOo", "DEBE02YY40000Atr", "DEBE02YY400000kY"])(
    "hands %s to the editor as a building it accepts, with nothing marked as edited",
    (gid) => {
      const { detail, survey, neighbours } = load(gid);
      const result = analyzePart(detail, survey.partGid, surveyOf(survey), neighbours, "de");
      if (!result.ok) throw new Error(result.reason);
      const { building, energy } = result.analysis;
      expect(building.storeys.length).toBeGreaterThan(0);
      expect(energy.windowArea).toBeGreaterThan(0);
      expect(sourceRows(building).filter((r) => r.edited)).toEqual([]);
    },
  );

  it("still computes a part nobody photographed, its walls closed until someone measures them", () => {
    const { detail, survey, neighbours } = load("DEBE02YY40000BOo");
    const empty: BuildingSurvey = {
      facts: { ageClass: "bis1918", ageClassConfirmed: false },
      walls: {},
    };
    const result = analyzePart(detail, survey.partGid, empty, neighbours, "en");
    if (!result.ok) throw new Error(result.reason);
    expect(result.analysis.report.catalogueOpenings).toBe(0);
    expect(result.analysis.energy.windowArea).toBe(0);
    expect(result.analysis.energy.heated).toBe(true);
    expect(result.analysis.energy.heatingDemand).toBeGreaterThan(0);
  });

  it("lists the parts with geometry, largest first", () => {
    const { detail } = load("DEBE02YY400000kY");
    const parts = partsWithGeometry(detail);
    expect(parts.length).toBeGreaterThan(5);
    expect(parts[0]!.footprintArea).toBeGreaterThanOrEqual(parts[1]!.footprintArea ?? 0);
  });
});
