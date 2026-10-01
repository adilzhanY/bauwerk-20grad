import { beforeEach, describe, expect, it } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { exampleHouse } from "@/lib/examples";
import { resetIds } from "@/lib/ids";
import { useEditorStore } from "@/store/building";
import { LeftPanel } from "@/components/editor/LeftPanel";

beforeEach(() => {
  resetIds();
  useEditorStore.setState({ language: "en", projectId: null, photoWall: null });
  useEditorStore.getState().loadBuilding(exampleHouse("en"));
});

const row = (name: string) => screen.getByRole("button", { name: new RegExp(`^${name}`) });

describe("photos and files in the layers tree", () => {
  it("lists every wall's photo for the whole building, previews one, and adds another", () => {
    const store = useEditorStore.getState();
    store.setFacadePhoto(1, { url: "blob:wall-2", width: 40, height: 30 });
    const storey = store.building.storeys[0];
    if (!storey) throw new Error("no storey");
    store.setFloorPlanImage(storey.id, { url: "blob:plan", width: 40, height: 30 });
    render(<LeftPanel syncStatus="local" />);

    fireEvent.click(row("Photos and files"));
    fireEvent.click(row("Facade photos"));
    // Wall 2 has its photo; a click opens it in the middle of the page.
    fireEvent.click(row("Wall 2"));
    const dialog = screen.getByRole("dialog", { name: "Facade photo, wall 2" });
    expect(dialog.querySelector("img")?.getAttribute("src")).toBe("blob:wall-2");
    // Over the whole page, not trapped in the panel it was opened from.
    expect(dialog.parentElement?.parentElement).toBe(document.body);
    fireEvent.click(screen.getByRole("button", { name: "Close" }));

    // Hovering a wall's row lights that wall in the 3D view, and leaving it clears it.
    fireEvent.pointerEnter(row("Wall 3").closest("li") as HTMLElement);
    expect(useEditorStore.getState().highlightedWall).toBe(2);
    fireEvent.pointerLeave(row("Wall 3").closest("li") as HTMLElement);
    expect(useEditorStore.getState().highlightedWall).toBeNull();

    // Wall 1 has none: a click starts the photo editor for it.
    fireEvent.click(row("Wall 1"));
    expect(useEditorStore.getState().photoWall).toBe(0);

    // The floor plan is listed with the building and under its storey.
    fireEvent.click(row("Floor plans"));
    // The storey itself and its plan in the building's list.
    expect(screen.getAllByRole("button", { name: new RegExp(`^${storey.name}`) })).toHaveLength(2);
    expect(screen.getAllByRole("button", { name: /^Floor plan/ }).length).toBeGreaterThan(0);
  });

  it("offers files only once the project is saved", () => {
    render(<LeftPanel syncStatus="local" />);
    fireEvent.click(row("Photos and files"));
    fireEvent.click(row("Files"));
    expect(screen.getByText("Save the project to keep files with it.")).toBeTruthy();
  });
});
