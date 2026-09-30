import { describe, expect, it } from "vitest";
import type { ProjectSummary } from "@/geometry/project";
import { landingRoute, newProjectQuery, readNewProject } from "@/app/projectRoutes";

const summary = (patch: Partial<ProjectSummary>): ProjectSummary => ({
  title: "Methfesselstraße 8",
  use: "Wohnhaus",
  storeys: 5,
  client: null,
  gid: "DEBE02YY40000BOo",
  energyClass: "E",
  endEnergy: 201,
  stage: "survey",
  steps: [false, false, false, false],
  origin: null,
  footprint: [],
  ...patch,
});

describe("landingRoute", () => {
  it("opens a project at its first step not yet done", () => {
    expect(landingRoute(summary({}))).toEqual({ page: "building", gid: "DEBE02YY40000BOo" });
    expect(landingRoute(summary({ steps: [true, false, false, false] }))).toEqual({
      page: "editor",
    });
    expect(landingRoute(summary({ steps: [true, true, false, false] }))).toEqual({
      page: "variants",
    });
    expect(landingRoute(summary({ steps: [true, true, true, false] }))).toEqual({
      page: "report",
    });
  });

  it("opens a building drawn by hand, or a finished project, in the editor", () => {
    expect(landingRoute(summary({ gid: null }))).toEqual({ page: "editor" });
    expect(landingRoute(summary({ stage: "done" }))).toEqual({ page: "editor" });
  });
});

describe("new project in the address", () => {
  it("carries name and client there and back, and nothing without the flag", () => {
    const query = newProjectQuery({ name: " Haus Krüger ", client: "Familie Krüger" });
    expect(readNewProject(query)).toEqual({ name: "Haus Krüger", client: "Familie Krüger" });
    expect(readNewProject(newProjectQuery({ name: "", client: "" }))).toEqual({
      name: "",
      client: "",
    });
    expect(readNewProject("?at=13.4,52.5,17")).toBeNull();
  });
});
