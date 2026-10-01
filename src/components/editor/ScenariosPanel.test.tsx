import { beforeEach, describe, expect, it } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { exampleHouse } from "@/lib/examples";
import { resetIds } from "@/lib/ids";
import { PRESET_IDS } from "@/geometry/constructions";
import { evaluateScenario } from "@/geometry/scenarios";
import { formatNumber } from "@/lib/format";
import { useEditorStore } from "@/store/building";
import { ScenariosPanel } from "@/components/editor/ScenariosPanel";

beforeEach(() => {
  resetIds();
  useEditorStore.setState({ language: "en", viewScenarioId: null });
  useEditorStore.getState().loadBuilding({ ...exampleHouse("en"), scenarios: [] });
});

describe("subsidy in the scenarios", () => {
  it("shows each measure's subsidy, the total and the own share", () => {
    const s = useEditorStore.getState();
    const id = s.addScenario("Wall and heat pump", {
      overrides: { wall: PRESET_IDS.wallInsulated },
      heating: { carrier: "heatPumpAir", efficiency: 3, hotWater: 12.5 },
    });
    s.setViewScenario(id);
    render(<ScenariosPanel />);
    const b = useEditorStore.getState().building;
    const scenario = b.scenarios?.find((x) => x.id === id);
    if (!scenario) throw new Error("no scenario");
    const r = evaluateScenario(b, scenario);
    expect(r.subsidy.total).toBeGreaterThan(0);
    expect(screen.getByText(/KfW heating subsidy 46 %/)).toBeTruthy();
    const block = within(
      screen.getByText("Payback of the own share").closest("div")?.parentElement ?? document.body,
    );
    expect(block.getByText(`${formatNumber(r.subsidy.ownShare, "en", 0)} €`)).toBeTruthy();
  });
});

describe("choosing a scenario in the table", () => {
  it("shows only the chosen scenario below, and renames it with Save", () => {
    const s = useEditorStore.getState();
    s.addScenario("Scenario 1", { overrides: { wall: PRESET_IDS.wallInsulated } });
    const two = s.addScenario("Scenario 2");
    const { rerender } = render(<ScenariosPanel />);

    fireEvent.click(screen.getByRole("button", { name: /Scenario 2/ }));
    rerender(<ScenariosPanel />);
    const name = screen.getByLabelText<HTMLInputElement>("Scenario name");
    expect(name.value).toBe("Scenario 2");
    expect(screen.getAllByLabelText("Scenario name")).toHaveLength(1);

    // Save shows up only once the name differs, and saves it.
    expect(screen.queryByRole("button", { name: "Save" })).toBeNull();
    fireEvent.change(name, { target: { value: "Heat pump first" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(useEditorStore.getState().building.scenarios?.find((x) => x.id === two)?.name).toBe(
      "Heat pump first",
    );
    rerender(<ScenariosPanel />);
    expect(screen.queryByRole("button", { name: "Save" })).toBeNull();
  });
});

describe("the roadmap", () => {
  it("counts its years from 1 and says which payback is which", () => {
    render(<ScenariosPanel />);
    // Without saved scenarios the full envelope variant is the one step, done in year 1.
    expect(screen.getByText("Year 1")).toBeTruthy();
    expect(screen.queryByText("Year 0")).toBeNull();
    expect(screen.getByText(/The whole roadmap runs to year 1\./)).toBeTruthy();
    expect(screen.getByText(/before any subsidy/)).toBeTruthy();
  });
});
