import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { App } from "@/App";
import { useRouter } from "@/app/router";
import { exampleAltbau } from "@/lib/examples";
import { resetIds } from "@/lib/ids";
import { createDefaultBuilding, useEditorStore } from "@/store/building";

beforeEach(() => {
  // These tests are about the editor, the page a building opens in.
  useRouter.setState({ route: { page: "editor" } });
  window.innerWidth = 1600;
  resetIds();
  useEditorStore.setState({
    building: createDefaultBuilding("en"),
    language: "en",
    selection: null,
    tool: "select",
    past: [],
    future: [],
  });
  useEditorStore.getState().endBatch();
  useEditorStore.setState((s) => ({ activeStoreyId: s.building.storeys[0]?.id ?? null }));
  // setState goes through the Immer middleware and therefore through the history
  // wrapper, so replacing the building above recorded one entry. Clear it.
  useEditorStore.setState({ past: [], future: [] });
});

describe("App", () => {
  it("renders the panels and the WebGL-missing state under jsdom", () => {
    render(<App />);
    const tree = screen.getByRole("tree", { name: "Layers" });
    expect(within(tree).getByRole("button", { name: "Bauwerk" })).toBeTruthy();
    expect(screen.getByRole("tab", { name: "Properties" })).toBeTruthy();
    expect(screen.getByText("WebGL is not available")).toBeTruthy();
    expect(screen.getByText("Ground floor")).toBeTruthy();
  });

  it("switches tools from the palette and shows the tool hint", () => {
    render(<App />);
    fireEvent.click(screen.getByRole("radio", { name: /Opening/ }));
    expect(useEditorStore.getState().tool).toBe("opening");
    expect(screen.getByText(/Click an exterior wall for a window/)).toBeTruthy();
  });

  it("adds a storey with the button and undoes it from the bottom bar", () => {
    render(<App />);
    fireEvent.click(screen.getByRole("button", { name: "Add storey" }));
    expect(useEditorStore.getState().building.storeys).toHaveLength(2);
    expect(screen.getByText("1st floor")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Undo" }));
    expect(useEditorStore.getState().building.storeys).toHaveLength(1);
    expect(screen.getByRole("button", { name: "Redo" })).not.toHaveProperty("disabled", true);
  });

  it("creates a named building from dimensions as a new project", async () => {
    render(<App />);
    fireEvent.click(screen.getByRole("button", { name: "New building" }));
    const dialog = screen.getByRole("dialog", { name: "New building" });
    const name = within(dialog).getByLabelText("Building name", { selector: "input" });
    fireEvent.change(name, { target: { value: "Garden house" } });
    fireEvent.blur(name);
    const storeys = within(dialog).getByLabelText("Storeys", { selector: "input" });
    fireEvent.focus(storeys);
    fireEvent.change(storeys, { target: { value: "3" } });
    fireEvent.blur(storeys);
    fireEvent.click(within(dialog).getByRole("button", { name: "Create building" }));

    await act(async () => {
      await Promise.resolve();
    });
    expect(useEditorStore.getState().building.name).toBe("Garden house");
    expect(document.title).toBe("Garden house · Bauwerk");
    const tree = screen.getByRole("tree", { name: "Layers" });
    expect(within(tree).getByRole("button", { name: "Garden house" })).toBeTruthy();
    expect(useEditorStore.getState().building.storeys).toHaveLength(3);
    // A new project starts from its building, with no undo back into the one before.
    expect(useEditorStore.getState().past).toHaveLength(0);
  });

  it("switches the whole UI to German", () => {
    render(<App />);
    fireEvent.click(screen.getByRole("tab", { name: "Settings" }));
    fireEvent.click(screen.getByRole("combobox", { name: "Language" }));
    fireEvent.click(screen.getByRole("option", { name: "Deutsch" }));
    fireEvent.click(screen.getByRole("tab", { name: "Ebenen" }));
    const tree = screen.getByRole("tree", { name: "Ebenen" });
    expect(within(tree).getByRole("button", { name: "Bauwerk" })).toBeTruthy();
    expect(screen.getByRole("tab", { name: "Eigenschaften" })).toBeTruthy();
    expect(screen.getByText("WebGL ist nicht verfügbar")).toBeTruthy();
  });

  it("loads the large office tower from the example selector", async () => {
    render(<App />);
    fireEvent.click(screen.getByRole("tab", { name: "Settings" }));
    fireEvent.click(screen.getByRole("combobox", { name: "Load example" }));
    fireEvent.click(screen.getByRole("option", { name: "Large office tower" }));
    await act(async () => {
      await Promise.resolve();
    });
    const building = useEditorStore.getState().building;
    expect(building.name).toBe("Berlin office tower, 18 storeys");
    expect(building.storeys).toHaveLength(18);
    expect(building.storeys.reduce((sum, storey) => sum + storey.rooms.length, 0)).toBe(162);
  });

  it("shows opening properties with a validation message for an invalid opening", () => {
    render(<App />);
    const s = useEditorStore.getState();
    const storeyId = s.activeStoreyId ?? "";
    act(() => {
      const id = s.addOpening(storeyId, {
        wallIndex: 0,
        kind: "window",
        offset: 9.5,
        width: 1.2,
        height: 1.4,
        sill: 0.9,
      });
      s.select({ kind: "opening", storeyId, id });
    });
    const alert = screen.getByRole("alert");
    expect(within(alert).getByText("The opening extends past the end of the wall.")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Remove opening" }));
    expect(useEditorStore.getState().building.storeys[0]?.openings).toHaveLength(0);
  });

  it("commits a number typed with a comma live, as one undo step", () => {
    render(<App />);
    fireEvent.click(screen.getByRole("tab", { name: "Settings" }));
    const input = screen.getByLabelText("Wall thickness", { selector: "input" });
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: "0,4" } });
    expect(useEditorStore.getState().building.wallThickness).toBeCloseTo(0.4);
    fireEvent.change(input, { target: { value: "0,45" } });
    expect(useEditorStore.getState().building.wallThickness).toBeCloseTo(0.45);
    fireEvent.blur(input);
    expect(useEditorStore.getState().past).toHaveLength(1);
  });

  it("the slider updates the model on every tick and undoes as one step", () => {
    render(<App />);
    fireEvent.click(screen.getByRole("tab", { name: "Settings" }));
    const slider = screen.getByRole("slider", { name: "Wall thickness" });
    fireEvent.keyDown(slider, { key: "ArrowRight", shiftKey: true }); // 0.3 + 10 x 0.05
    expect(useEditorStore.getState().building.wallThickness).toBeCloseTo(0.8);
    fireEvent.keyDown(slider, { key: "ArrowLeft" });
    expect(useEditorStore.getState().building.wallThickness).toBeCloseTo(0.75);
    fireEvent.keyUp(slider, { key: "ArrowLeft" });
    expect(useEditorStore.getState().past).toHaveLength(1);
    fireEvent.click(screen.getByRole("button", { name: "Undo" }));
    expect(useEditorStore.getState().building.wallThickness).toBeCloseTo(0.3);
  });

  it("does not let slider keys switch storeys", () => {
    const state = useEditorStore.getState();
    const groundId = state.activeStoreyId ?? "";
    act(() => {
      state.addStorey();
      state.setActiveStorey(groundId);
    });
    render(<App />);
    fireEvent.click(screen.getByRole("tab", { name: "Settings" }));
    const slider = screen.getByRole("slider", { name: "Wall thickness" });
    slider.focus();
    fireEvent.keyDown(slider, { key: "PageUp" });
    expect(useEditorStore.getState().activeStoreyId).toBe(groundId);
  });

  it("shows the empty state when the last storey is removed", () => {
    render(<App />);
    fireEvent.click(screen.getByRole("button", { name: "Remove storey" }));
    expect(screen.getByText("No storeys")).toBeTruthy();
  });

  it("shows the energy panel with a class band and the renovated scenario", () => {
    render(<App />);
    fireEvent.click(screen.getByRole("tab", { name: "Energy" }));
    expect(screen.getByRole("heading", { name: "Energy" })).toBeTruthy();
    const currentScale = screen.getByLabelText(/Energy efficiency class: H/);
    expect(currentScale.getAttribute("viewBox")).toBe("0 0 400 82");
    expect(currentScale.querySelector("rect")?.getAttribute("height")).toBe("24");
    fireEvent.click(screen.getByRole("radio", { name: "Renovated" }));
    const renovatedScale = screen.getByLabelText(/Energy efficiency class: (A\+|A|B|C|D|E|F|G)$/);
    expect(renovatedScale.getAttribute("viewBox")).toBe("0 0 400 112");
    expect(screen.getByText("Saving")).toBeTruthy();
    fireEvent.click(screen.getByRole("tab", { name: "Scenarios" }));
    fireEvent.click(screen.getByRole("button", { name: "New scenario" }));
    expect(useEditorStore.getState().building.scenarios).toHaveLength(1);
    expect(screen.getByRole("button", { name: "Remove scenario" })).toBeTruthy();
  });

  it("renders the print view as a plain document with German conventions", () => {
    window.history.replaceState(null, "", "/?print=1");
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 8, 5, 18, 4));
    const { container } = render(<App />);
    expect(screen.getByText("Building report")).toBeTruthy();
    expect(screen.getByText(/Issued on/).textContent).toContain("05.09.2026, 18:04");
    expect(container.querySelectorAll("[class*='rounded']")).toHaveLength(0);
    expect(container.querySelectorAll("[class*='shadow']")).toHaveLength(0);
    expect(screen.getByRole("img", { name: /Energy efficiency class/ })).toBeTruthy();
    expect(screen.getByRole("img", { name: "Ground floor" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Print" })).toBeTruthy();
    // German number format regardless of the English interface: 80 m² floor, 268 m² envelope shown as "268".
    expect(screen.getAllByText(/1\.234|268 m²|80 m²/).length).toBeGreaterThan(0);
    expect(container.textContent).toMatch(/\d+,\d+ W\/\(m²K\)/);
    vi.useRealTimers();
    window.history.replaceState(null, "", "/");
  });

  it("shows a correctly named radiator removal action and validation", () => {
    const building = exampleAltbau("en");
    const storey = building.storeys[0];
    const radiator = storey?.radiators?.[0];
    if (!storey || !radiator) throw new Error("The Altbau fixture needs a radiator");
    radiator.offset = 100;
    act(() => {
      useEditorStore.getState().loadBuilding(building);
      useEditorStore.getState().select({ kind: "radiator", storeyId: storey.id, id: radiator.id });
    });
    render(<App />);
    expect(screen.getByRole("button", { name: "Remove radiator" })).toBeTruthy();
    expect(screen.getByRole("alert").textContent).toContain(
      "The radiator leaves its wall or overlaps an opening.",
    );
  });

  it("prints all known document names in the selected German language", () => {
    act(() => {
      useEditorStore.getState().loadBuilding(exampleAltbau("en"));
      useEditorStore.getState().setLanguage("de");
    });
    window.history.replaceState(null, "", "/?print=1");
    render(<App />);

    expect(screen.getAllByText("Altbau Kreuzberg, Baujahr 1905").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Ladenlokal").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Treppenhaus").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Ziegelwand, ungedämmt").length).toBeGreaterThan(0);
    expect(screen.getByText("Fenster und Dach")).toBeTruthy();
    expect(screen.queryByText("Kreuzberg apartment house, built 1905")).toBeNull();
    expect(screen.queryByText("Shop")).toBeNull();
    expect(screen.queryByText("Brick wall, uninsulated")).toBeNull();
    expect(screen.queryByText("Windows and roof")).toBeNull();

    window.history.replaceState(null, "", "/");
  });

  it("has eight tools including measure, heating and move, switchable by key", () => {
    render(<App />);
    const palette = screen.getByRole("radiogroup", { name: "Tools" });
    expect(within(palette).getAllByRole("radio")).toHaveLength(8);
    fireEvent.keyDown(window, { key: "6" });
    expect(useEditorStore.getState().tool).toBe("measure");
    expect(screen.getByText(/where a distance starts and ends/)).toBeTruthy();
  });

  it("uses no native form controls outside the components folder", () => {
    const { container } = render(<App />);
    fireEvent.click(screen.getByRole("tab", { name: "Energy" }));
    expect(container.querySelectorAll("select")).toHaveLength(0);
    expect(container.querySelectorAll("input[type=range]")).toHaveLength(0);
    expect(container.querySelectorAll("input[type=checkbox]")).toHaveLength(0);
    expect(container.querySelectorAll("input[type=number]")).toHaveLength(0);
  });

  it("keeps uppercase to the mono section labels", () => {
    const { container } = render(<App />);
    const upper = [...container.querySelectorAll(".uppercase")];
    expect(upper.length).toBeGreaterThan(0);
    for (const element of upper) expect(element.classList.contains("font-num")).toBe(true);
    fireEvent.keyDown(window, { key: "6" });
    expect(container.querySelector("[data-tool='measure']")).toBeTruthy();
  });

  it("offers the map once a location is set, off by default, with the attribution", () => {
    render(<App />);
    expect(screen.queryByText("© OpenStreetMap contributors")).toBeNull();
    fireEvent.click(screen.getByRole("tab", { name: "Site" }));
    fireEvent.click(screen.getByRole("switch", { name: "Place the building on the map" }));
    // The plain grid stays the ground until the map is switched on.
    const map = screen.getByRole("switch", { name: "Show map (OpenStreetMap)" });
    expect(map.getAttribute("aria-checked")).toBe("false");
    expect(screen.queryByText("© OpenStreetMap contributors")).toBeNull();
    fireEvent.click(map);
    expect(screen.getByRole("link", { name: "© OpenStreetMap contributors" })).toBeTruthy();
    fireEvent.click(screen.getByRole("switch", { name: "Show map (OpenStreetMap)" }));
    expect(screen.queryByText("© OpenStreetMap contributors")).toBeNull();
  });

  it("switches the theme and stamps it on the document", () => {
    render(<App />);
    fireEvent.click(screen.getByRole("tab", { name: "Settings" }));
    fireEvent.click(screen.getByRole("radio", { name: "Dark" }));
    expect(useEditorStore.getState().theme).toBe("dark");
  });

  it("renders the benchmark page with the fifty storey building", () => {
    window.history.replaceState(null, "", "/?bench=1");
    render(<App />);
    expect(screen.getByRole("heading", { name: "Benchmark" })).toBeTruthy();
    expect(useEditorStore.getState().building.storeys).toHaveLength(50);
    window.history.replaceState(null, "", "/");
  });

  it("opens the shortcut sheet", () => {
    render(<App />);
    fireEvent.click(screen.getByRole("button", { name: "Keyboard shortcuts" }));
    expect(screen.getByRole("dialog")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("renders the too-narrow view when window width is under 1440px", () => {
    window.innerWidth = 1200;
    render(<App />);
    expect(screen.getByRole("heading", { name: "Desktop browser needed" })).toBeTruthy();
  });
});
