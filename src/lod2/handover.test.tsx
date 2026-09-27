import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { App } from "@/App";
import { useRouter } from "@/app/router";
import type { Selection } from "@/store/building";
import { useEditorStore } from "@/store/building";
import { analyzePart } from "./analysis";
import { loadFixture, surveyFromFixture } from "./testFixtures";

/**
 * The editor with a building handed over from the building page, the way "Sanierungsplanung
 * starten" loads it. Such a building carries sources for its values, which a drawn one does
 * not, so the panels take paths here (the source notes) that the other editor tests never do.
 */
function loadSurveyedBuilding() {
  const { detail, survey, neighbours } = loadFixture("DEBE02YY40000BOo");
  const result = analyzePart(detail, survey.partGid, surveyFromFixture(survey), neighbours, "en");
  if (!result.ok) throw new Error(result.reason);
  useEditorStore.getState().loadBuilding(result.analysis.building);
}

beforeEach(() => {
  useRouter.setState({ route: { page: "editor" } });
  window.innerWidth = 1600;
  useEditorStore.setState({ language: "en", selection: null, tool: "select" });
  loadSurveyedBuilding();
});

describe("editor with a building from the building page", () => {
  it("renders every kind of selection without an error", () => {
    const errors = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const { building } = useEditorStore.getState();
    const storey = building.storeys[0];
    if (!storey) throw new Error("no storey");
    const selections: Selection[] = [
      { kind: "roof" },
      { kind: "storey", id: storey.id },
      ...building.footprint.map((_, wallIndex): Selection => ({
        kind: "wall",
        storeyId: storey.id,
        wallIndex,
      })),
      ...storey.openings
        .slice(0, 3)
        .map((o): Selection => ({ kind: "opening", storeyId: storey.id, id: o.id })),
      ...storey.rooms
        .slice(0, 2)
        .map((r): Selection => ({ kind: "room", storeyId: storey.id, id: r.id })),
    ];
    for (const selection of selections) {
      useEditorStore.setState({ selection, activeStoreyId: storey.id });
      const { unmount } = render(<App />);
      expect(screen.queryByText(/stopped with an error/i)).toBeNull();
      unmount();
    }
    expect(errors).not.toHaveBeenCalled();
    errors.mockRestore();
  });
});
