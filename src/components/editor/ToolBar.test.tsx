import { beforeEach, describe, expect, it } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { createDefaultBuilding, useEditorStore } from "@/store/building";
import { ToolBar } from "@/components/editor/ToolBar";
import { ViewPill } from "@/components/editor/ViewPill";
import { StoreyPill } from "@/components/editor/StoreyPill";
import { StatusLine } from "@/components/editor/StatusLine";

beforeEach(() => {
  useEditorStore.setState({
    building: createDefaultBuilding("en"),
    language: "en",
    tool: "select",
    selection: null,
    projectRole: null,
    planView: false,
    showBridges: false,
    otherStoreys: { above: "outline", below: "ghost", roof: "outline", ghostOpacity: 0.15 },
  });
  useEditorStore.setState((s) => ({ activeStoreyId: s.building.storeys[0]?.id ?? null }));
});

describe("tool bar", () => {
  it("puts the survey tools in one click each and the rest under More", () => {
    render(<ToolBar layersOpen onToggleLayers={() => undefined} />);
    fireEvent.click(screen.getByRole("radio", { name: "Window" }));
    expect(useEditorStore.getState().tool).toBe("window");
    fireEvent.click(screen.getByRole("radio", { name: "Door" }));
    expect(useEditorStore.getState().tool).toBe("door");
    expect(screen.queryByRole("radio", { name: "Outline" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "More" }));
    fireEvent.click(screen.getByRole("menuitem", { name: /Outline/ }));
    expect(useEditorStore.getState().tool).toBe("footprint");
  });

  it("closing its menu with Escape keeps the selection", () => {
    useEditorStore.getState().select({ kind: "roof" });
    render(<ToolBar layersOpen onToggleLayers={() => undefined} />);
    fireEvent.click(screen.getByRole("button", { name: "More" }));
    expect(screen.getByRole("menu")).toBeTruthy();
    // The editor's own Escape listens on the window and skips what was already used.
    let reached = false;
    const onWindow = (e: KeyboardEvent) => {
      reached = !e.defaultPrevented;
    };
    window.addEventListener("keydown", onWindow);
    fireEvent.keyDown(document.body, { key: "Escape" });
    window.removeEventListener("keydown", onWindow);
    expect(screen.queryByRole("menu")).toBeNull();
    expect(reached).toBe(false);
  });

  it("shows a viewer only the tools that look", () => {
    useEditorStore.setState({ projectRole: "viewer" });
    render(<ToolBar layersOpen onToggleLayers={() => undefined} />);
    expect(screen.getByRole("radio", { name: "Select" })).toBeTruthy();
    expect(screen.getByRole("radio", { name: "Measure" })).toBeTruthy();
    expect(screen.queryByRole("radio", { name: "Window" })).toBeNull();
    expect(screen.queryByRole("button", { name: "More" })).toBeNull();
  });
});

describe("view switch", () => {
  it("has 3D and the plan first, then the elevations", () => {
    render(<ViewPill panelsOpen onTogglePanels={() => undefined} />);
    const names = screen.getAllByRole("radio").map((r) => r.getAttribute("aria-label"));
    expect(names).toEqual([
      "3D view",
      "2D plan view",
      "North elevation",
      "East elevation",
      "South elevation",
      "West elevation",
    ]);
    fireEvent.click(screen.getByRole("radio", { name: "2D plan view" }));
    expect(useEditorStore.getState().planView).toBe(true);
    fireEvent.click(screen.getByRole("radio", { name: "3D view" }));
    expect(useEditorStore.getState().planView).toBe(false);
  });

  it("holds what the scene shows in the View menu", () => {
    render(<ViewPill panelsOpen onTogglePanels={() => undefined} />);
    fireEvent.click(screen.getByRole("button", { name: /View/ }));
    const menu = screen.getByRole("dialog", { name: "View" });
    expect(menu).toBeTruthy();
    fireEvent.click(screen.getByRole("switch", { name: "Show thermal bridges" }));
    expect(useEditorStore.getState().showBridges).toBe(true);
    fireEvent.click(screen.getByRole("switch", { name: "Whole building" }));
    expect(useEditorStore.getState().otherStoreys.below).toBe("solid");
    // The map needs a location first.
    const map = screen.getByRole("switch", { name: "Map as the ground" });
    expect(map.getAttribute("aria-disabled")).toBe("true");
  });
});

describe("storey pill", () => {
  it("adds a storey from its +", () => {
    render(<StoreyPill />);
    fireEvent.click(screen.getByRole("button", { name: "Add storey" }));
    expect(useEditorStore.getState().building.storeys).toHaveLength(2);
  });
});

describe("status line", () => {
  it("shows the tool's hint, and in the plan how its dimensions read", () => {
    useEditorStore.setState({ tool: "measure" });
    render(<StatusLine />);
    expect(screen.getByText(/where a distance starts and ends/)).toBeTruthy();
    expect(screen.queryByText(/A raised ⁵ adds half a centimetre/)).toBeNull();
    act(() => {
      useEditorStore.getState().setPlanView(true);
    });
    expect(screen.getByText(/A raised ⁵ adds half a centimetre/)).toBeTruthy();
  });
});
