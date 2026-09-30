import { beforeEach, describe, expect, it } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { exampleHouse } from "@/lib/examples";
import { resetIds } from "@/lib/ids";
import { computeEnergy } from "@/geometry/energy";
import { supplyOf } from "@/geometry/supply";
import { formatNumber } from "@/lib/format";
import { useEditorStore } from "@/store/building";
import { EnergyPanel } from "@/components/editor/EnergyPanel";

beforeEach(() => {
  resetIds();
  useEditorStore.setState({ language: "en", viewScenarioId: null });
  useEditorStore.getState().loadBuilding(exampleHouse("en"));
});

/** The value in the row `label` of the heating and costs table, "Now" column. */
function nowValue(label: string): string {
  const row = screen.getByText(label).closest("tr");
  return row?.querySelectorAll("td")[1]?.textContent ?? "";
}

describe("heating and costs", () => {
  it("shows what supplyOf computes for the building", () => {
    render(<EnergyPanel />);
    const b = useEditorStore.getState().building;
    const s = supplyOf(b, computeEnergy(b));
    expect(screen.getByRole("heading", { name: "Heating and costs" })).toBeTruthy();
    expect(nowValue("End energy")).toBe(`${formatNumber(s.endEnergy, "en", 0)} kWh/a`);
    expect(nowValue("Heating cost, CO2 price included")).toBe(
      `${formatNumber(s.cost, "en", 0)} €/a`,
    );
    // Owner-occupied by default: no landlord row.
    expect(screen.queryByText("Landlord's share of the CO2 cost (CO2KostAufG)")).toBeNull();
  });

  it("changes with the heating system, and shows the landlord's share once rented", () => {
    const { rerender } = render(<EnergyPanel />);
    const gasCost = nowValue("Heating cost, CO2 price included");
    useEditorStore.getState().setHeating({ carrier: "heatPumpAir", efficiency: 3.2 });
    useEditorStore.getState().setEconomics({ ownerOccupied: false });
    rerender(<EnergyPanel />);
    expect(nowValue("Heating cost, CO2 price included")).not.toBe(gasCost);
    expect(nowValue("of it the CO2 price")).toBe("0 €/a");
    expect(screen.getByText("Landlord's share of the CO2 cost (CO2KostAufG)")).toBeTruthy();
  });
});

describe("store actions", () => {
  it("each change of heating or economics is one undo step, and prices merge", () => {
    const s = () => useEditorStore.getState();
    const before = s().building;
    s().setHeating({ carrier: "oil" });
    expect(s().building.heating).toMatchObject({ carrier: "oil", hotWater: 12.5 });
    s().setEconomics({ prices: { oil: 0.09 } });
    s().setEconomics({ prices: { gas: 0.1 }, dwellings: 3 });
    expect(s().building.economics).toEqual({ prices: { oil: 0.09, gas: 0.1 }, dwellings: 3 });
    s().undo();
    s().undo();
    s().undo();
    expect(s().building).toBe(before);
  });
});

describe("the scenario switch", () => {
  /** The shown label of the select called `label`. */
  const selected = (label: string) => screen.getByRole("combobox", { name: label }).textContent;

  it("shows the chosen scenario's heating and constructions, and edits go into it", () => {
    const s = () => useEditorStore.getState();
    const wall = s().building.constructions.filter((c) => c.category === "wall");
    const one = s().addScenario("Scenario 1", {
      heating: { carrier: "gas", efficiency: 0.9, hotWater: 12.5 },
    });
    const two = s().addScenario("Scenario 2", {
      heating: { carrier: "heatPumpAir", efficiency: 3.2, hotWater: 12.5 },
      overrides: { wall: wall[wall.length - 1]?.id },
    });
    const { rerender } = render(<EnergyPanel />);
    s().setViewScenario(one);
    rerender(<EnergyPanel />);
    expect(selected("Energy carrier")).toContain("Natural gas");

    s().setViewScenario(two);
    rerender(<EnergyPanel />);
    expect(selected("Energy carrier")).toContain("Heat pump, air");
    expect(selected("Exterior walls")).toContain(wall[wall.length - 1]?.name ?? "?");

    // Editing while Scenario 2 is shown changes Scenario 2, not the building.
    const heatingBefore = s().building.heating;
    fireEvent.click(screen.getByRole("combobox", { name: "Energy carrier" }));
    fireEvent.click(screen.getByRole("option", { name: /Wood pellets/ }));
    expect(s().building.heating).toEqual(heatingBefore);
    expect(s().building.scenarios?.find((x) => x.id === two)?.heating?.carrier).toBe("pellets");
  });
});
