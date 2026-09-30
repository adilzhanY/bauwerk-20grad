import { beforeEach, describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { exampleAltbau, exampleHouse } from "@/lib/examples";
import { resetIds } from "@/lib/ids";
import { heatPumpReadiness } from "@/geometry/hvac";
import { useEditorStore } from "@/store/building";
import { EnergyPanel } from "@/components/editor/EnergyPanel";

beforeEach(() => {
  resetIds();
  useEditorStore.setState({ language: "en", viewScenarioId: null });
});

describe("heat pump readiness in the panel", () => {
  it("shows the flow temperature the radiators need and the rooms that fall short", () => {
    useEditorStore.getState().loadBuilding(exampleAltbau("en"));
    render(<EnergyPanel />);
    const r = heatPumpReadiness(useEditorStore.getState().building);
    expect(screen.getByText("Heat pump readiness")).toBeTruthy();
    expect(screen.getByText(`${String(r.ready)} / ${String(r.rooms.length)}`)).toBeTruthy();
    const short = r.rooms.filter((x) => x.flow === null || x.flow > 55);
    expect(screen.getAllByText(/needs .* W rated, has/)).toHaveLength(short.length);
  });

  it("asks for radiators when there are none", () => {
    const b = exampleHouse("en");
    useEditorStore
      .getState()
      .loadBuilding({ ...b, storeys: b.storeys.map((s) => ({ ...s, radiators: [] })) });
    render(<EnergyPanel />);
    expect(screen.getByText(/Place radiators with the heating tool/)).toBeTruthy();
  });
});
