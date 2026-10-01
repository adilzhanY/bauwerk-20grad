import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { exampleHouse } from "@/lib/examples";
import { resetIds } from "@/lib/ids";
import { useEditorStore } from "@/store/building";
import { useProjectFiles } from "@/projects/files";
import { LeftPanel } from "@/components/editor/LeftPanel";

const removed: string[] = [];
vi.mock(import("@/projects/files"), async (original) => ({
  ...(await original()),
  reloadFiles: () => Promise.resolve(),
  removeFile: (_project: string, id: string) => {
    removed.push(id);
    return Promise.resolve();
  },
}));
vi.mock(import("@/lod2/api/floorplan"), async (original) => ({
  ...(await original()),
  useFloorplanAvailable: () => false,
}));

const file = {
  id: "f1",
  slot: null,
  name: "offer.pdf",
  mime: "application/pdf",
  size: 2048,
  width: null,
  height: null,
  uploadedBy: null,
  createdAt: "2026-10-01T10:00:00Z",
};

beforeEach(() => {
  resetIds();
  removed.length = 0;
  useEditorStore.setState({
    language: "en",
    projectId: null,
    projectRole: null,
    photoWall: null,
    facadePhotos: {},
    floorPlanImages: {},
  });
  useEditorStore.getState().loadBuilding(exampleHouse("en"));
  useProjectFiles.setState({ projectId: null, files: null, failed: false });
});

const facades = () => screen.getByRole("list", { name: "Facades and roof" });

describe("the survey panel", () => {
  it("lists each storey with its height, floor plan and rooms", () => {
    render(<LeftPanel />);
    const storey = useEditorStore.getState().building.storeys[0];
    if (!storey) throw new Error("no storey");
    const block = screen.getByRole("list", { name: storey.name });
    expect(within(block).getByRole("button", { name: /^Floor plan\s*missing/ })).toBeTruthy();
    expect(within(block).getByRole("button", { name: /rooms/ })).toBeTruthy();
    // A click on the storey makes it the one being edited and shows its properties.
    fireEvent.click(within(block).getByRole("button", { name: new RegExp(`^${storey.name}`) }));
    expect(useEditorStore.getState().selection).toEqual({ kind: "storey", id: storey.id });
  });

  it("opens the floor plan reading for that storey from Add plan", () => {
    const store = useEditorStore.getState();
    store.addStorey();
    const [ground, upper] = useEditorStore.getState().building.storeys;
    if (!ground || !upper) throw new Error("no storeys");
    store.setActiveStorey(upper.id);
    render(<LeftPanel />);
    fireEvent.click(screen.getByRole("button", { name: `Add a floor plan for ${ground.name}` }));
    expect(screen.getByRole("dialog", { name: `Floor plan, ${ground.name}` })).toBeTruthy();
    // The reading works on the active storey: the one the plan is for.
    expect(useEditorStore.getState().activeStoreyId).toBe(ground.id);
    expect(
      screen.getByText(
        /The AI is not running right now\. Everything else works\. A drawing can still be laid under the model/,
      ),
    ).toBeTruthy();
  });

  it("previews a storey's floor plan once it has one", () => {
    const storey = useEditorStore.getState().building.storeys[0];
    if (!storey) throw new Error("no storey");
    useEditorStore
      .getState()
      .setFloorPlanImage(storey.id, { url: "blob:plan", width: 4, height: 3 });
    render(<LeftPanel />);
    fireEvent.click(screen.getByRole("button", { name: /^Floor plan$/ }));
    const dialog = screen.getByRole("dialog");
    expect(dialog.querySelector("img")?.getAttribute("src")).toBe("blob:plan");
  });

  it("has one row per outside wall: photo, add photo, shared wall, and lights the wall", () => {
    const store = useEditorStore.getState();
    store.setFacadePhoto(1, { url: "blob:wall-2", width: 40, height: 30 });
    store.setEdgeShared(3, true);
    render(<LeftPanel />);
    const list = facades();

    // Wall 2 has its photo; a click opens it in the middle of the page.
    fireEvent.click(within(list).getByRole("button", { name: /^Wall 2/ }));
    const dialog = screen.getByRole("dialog", { name: "Facade photo, wall 2" });
    expect(dialog.querySelector("img")?.getAttribute("src")).toBe("blob:wall-2");
    fireEvent.click(screen.getByRole("button", { name: "Close" }));

    // Hovering a wall's row lights that wall in the 3D view, and leaving it clears it.
    const row3 = within(list)
      .getByRole("button", { name: /^Wall 3/ })
      .closest("li");
    if (!row3) throw new Error("no row");
    fireEvent.pointerEnter(row3);
    expect(useEditorStore.getState().highlightedWall).toBe(2);
    fireEvent.pointerLeave(row3);
    expect(useEditorStore.getState().highlightedWall).toBeNull();

    // Wall 1 has none: one click starts the photo editor for it.
    fireEvent.click(within(list).getByRole("button", { name: /^Wall 1/ }));
    expect(useEditorStore.getState().photoWall).toBe(0);

    // A shared wall is marked and offers no photo.
    expect(within(list).getByRole("button", { name: /^Wall 4.*shared/ })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Add a photo of wall 4" })).toBeNull();
  });

  it("picks the roof from its row", () => {
    render(<LeftPanel />);
    fireEvent.click(within(facades()).getByRole("button", { name: /^Roof/ }));
    expect(useEditorStore.getState().selection).toEqual({ kind: "roof" });
  });

  it("keeps the element tree folded under Elements", () => {
    render(<LeftPanel />);
    expect(screen.queryByRole("tree")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Elements" }));
    expect(screen.getByRole("tree", { name: "Layers" })).toBeTruthy();
  });

  it("opens the tree's folder of an element picked in the 3D view", () => {
    const store = useEditorStore.getState();
    const storey = store.building.storeys[0];
    const opening = storey?.openings[0];
    if (!storey || !opening) throw new Error("no opening");
    render(<LeftPanel />);
    fireEvent.click(screen.getByRole("button", { name: "Elements" }));
    act(() => {
      store.select({ kind: "opening", storeyId: storey.id, id: opening.id });
    });
    const tree = screen.getByRole("tree", { name: "Layers" });
    const picked = within(tree).getAllByRole("treeitem", { selected: true });
    expect(picked).toHaveLength(1);
  });

  it("offers files only once the project is saved", () => {
    render(<LeftPanel />);
    expect(screen.getByText("Save the project to keep files with it.")).toBeTruthy();
  });

  it("deletes a file from its row after a second click; a viewer cannot", () => {
    useEditorStore.setState({ projectId: "p1", projectRole: "owner" });
    useProjectFiles.setState({ projectId: "p1", files: [file], failed: false });
    const { unmount } = render(<LeftPanel />);
    fireEvent.click(screen.getByRole("button", { name: "Delete offer.pdf" }));
    expect(removed).toEqual([]);
    const confirm = screen.getByRole("button", { name: "Delete for everyone?" });
    expect(confirm.getAttribute("aria-pressed")).toBe("true");
    fireEvent.click(confirm);
    expect(removed).toEqual(["f1"]);
    unmount();

    useEditorStore.setState({ projectRole: "viewer" });
    render(<LeftPanel />);
    expect(screen.getByRole("button", { name: /^offer\.pdf/ })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Delete offer.pdf" })).toBeNull();
  });
});
