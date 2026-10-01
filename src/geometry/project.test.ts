import { describe, expect, it } from "vitest";
import { exampleHouse } from "@/lib/examples";
import { computeEnergy } from "./energy";
import { fromJson, toJson } from "./export";
import { projectSummary } from "./project";
import type { Building } from "./types";

const house = (): Building => exampleHouse("en");

describe("projectSummary", () => {
  it("titles a map building by its address and its use without the Gebäude-ID", () => {
    const b: Building = {
      ...house(),
      name: "Wohnhaus DEBE02YY40000BOo",
      project: { gid: "DEBE02YY40000BOo", address: "Methfesselstraße 8", client: "Familie Krüger" },
    };
    const s = projectSummary(b);
    expect(s.title).toBe("Methfesselstraße 8");
    expect(s.use).toBe("Wohnhaus");
    expect(s.client).toBe("Familie Krüger");
    expect(s.storeys).toBe(b.storeys.length);
    expect(s.energyClass).toBe(computeEnergy(b).energyClass);
  });

  it("follows the work done: survey, then variants, then report, unless set by hand", () => {
    const b = house();
    expect(projectSummary(b).stage).toBe("survey");
    const withScenario: Building = {
      ...b,
      scenarios: [{ id: "s", name: "Scenario 1", overrides: {} }],
    };
    expect(projectSummary(withScenario).stage).toBe("variants");
    expect(projectSummary(withScenario).steps[2]).toBe(true);
    const reported: Building = { ...withScenario, project: { reportAt: "2026-09-28T10:00:00Z" } };
    expect(projectSummary(reported).stage).toBe("report");
    expect(projectSummary({ ...reported, project: { stage: "done" } }).stage).toBe("done");
  });

  it("counts the survey as done once a value came from a photo", () => {
    const b = house();
    expect(projectSummary(b).steps[0]).toBe(false);
    const photographed: Building = { ...b, sources: { "opening:o1": { kind: "photo" } } };
    expect(projectSummary(photographed).steps[0]).toBe(true);
  });

  it("counts a building taken from LoD2 as surveyed, so the steps never show a gap", () => {
    const lod2: Building = { ...house(), project: { gid: "DEBE02YY40000BOo" } };
    expect(projectSummary(lod2).steps[0]).toBe(true);
  });

  it("keeps the use when the building is named after its address", () => {
    const b: Building = {
      ...house(),
      name: "Methfesselstraße 8",
      project: { gid: "DEBE02YY40000BOo", address: "Methfesselstraße 8", use: "Wohnhaus" },
    };
    expect(projectSummary(b).use).toBe("Wohnhaus");
    // A name typed by the consultant is not a use.
    expect(projectSummary({ ...b, project: { gid: "DEBE02YY40000BOo" } }).use).toBeNull();
  });
});

describe("project in the file format", () => {
  it("keeps the project facts and refuses a stage that does not exist", () => {
    const b: Building = {
      ...house(),
      project: { client: "WEG 6", stage: "variants", use: "Wohnhaus" },
    };
    const back = fromJson(toJson(b));
    expect(back.ok && back.building.project).toEqual({
      client: "WEG 6",
      stage: "variants",
      use: "Wohnhaus",
    });
    const wrong = JSON.parse(toJson(b)) as { building: { project: { stage: string } } };
    wrong.building.project.stage = "finished";
    expect(fromJson(JSON.stringify(wrong)).ok).toBe(false);
  });
});

describe("facade colour in the file format", () => {
  it("keeps a colour and refuses anything that is not #rrggbb", () => {
    const b: Building = { ...house(), facadeColor: "#c83c32" };
    const back = fromJson(toJson(b));
    expect(back.ok && back.building.facadeColor).toBe("#c83c32");
    const wrong = JSON.parse(toJson(b)) as { building: { facadeColor: string } };
    wrong.building.facadeColor = "red";
    expect(fromJson(JSON.stringify(wrong)).ok).toBe(false);
  });
});
