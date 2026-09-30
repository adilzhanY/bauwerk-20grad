import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { exampleHouse } from "@/lib/examples";
import { resetIds } from "@/lib/ids";
import { useEditorStore } from "@/store/building";
import { FloorPlanSection } from "@/components/editor/FloorPlanSection";

/** What lod2-floorplan answered for the ground floor plan of BOo. */
const reading = readFileSync(
  join(__dirname, "../../../lod2/sample-plans/DEBE02YY40000BOo-EG.walls.json"),
  "utf8",
);

beforeEach(() => {
  resetIds();
  useEditorStore.setState({ language: "en", planView: false, planReveal: null });
  useEditorStore.getState().loadBuilding(exampleHouse("en"));
  vi.stubGlobal(
    "URL",
    Object.assign(URL, { createObjectURL: () => "blob:plan", revokeObjectURL: () => undefined }),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
});

/** The service up or down; while `hold` is set, the walls answer waits for its release. */
function service(up: boolean, hold?: Promise<void>) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      if (!up) return new Response(null, { status: 502 });
      if (url.endsWith("/health")) return Response.json({ roomModel: true });
      await hold;
      return new Response(reading, { headers: { "content-type": "application/json" } });
    }),
  );
}

describe("reading a floor plan", () => {
  it("is hidden while the floor plan service is not running", async () => {
    service(false);
    const { container } = render(<FloorPlanSection />);
    await vi.waitFor(() => {
      expect(vi.mocked(fetch)).toHaveBeenCalled();
    });
    expect(container.textContent).toBe("");
  });

  it("shows what it found over the drawing and applies it to the storey in one step", async () => {
    let release: () => void = () => undefined;
    service(
      true,
      new Promise<void>((resolve) => {
        release = resolve;
      }),
    );
    render(<FloorPlanSection />);
    const input = await screen.findByLabelText("Read floor plan");
    fireEvent.change(input, {
      target: { files: [new File(["png"], "plan.png", { type: "image/png" })] },
    });
    // While the service works, the AI card shows the plan under the scan.
    expect(await screen.findByText("AI is reading the floor plan")).toBeTruthy();
    expect(screen.getByRole("status")).toBeTruthy();
    release();
    expect(await screen.findByText("6 interior walls and 8 doors found")).toBeTruthy();
    expect(screen.queryByText("AI is reading the floor plan")).toBeNull();
    expect(screen.getByRole("img", { name: /floor plan with the walls/ })).toBeTruthy();

    const before = useEditorStore.getState().building;
    const storey = before.storeys[0];
    if (!storey) throw new Error("no storey");
    fireEvent.click(screen.getByRole("button", { name: `Apply to ${storey.name}` }));
    const after = useEditorStore.getState().building.storeys[0];
    expect(after?.interiorWalls.length).toBeGreaterThan(0);
    // The AI's work is announced, and the plan view of the storey plays the reveal.
    expect(screen.getByText("Applied")).toBeTruthy();
    expect(screen.getByText(/walls, 8 doors and \d+ rooms placed by the AI/)).toBeTruthy();
    expect(useEditorStore.getState().planView).toBe(true);
    expect(useEditorStore.getState().activeStoreyId).toBe(storey.id);
    expect(useEditorStore.getState().planReveal?.storeyId).toBe(storey.id);
    expect(screen.queryByText("6 interior walls and 8 doors found")).toBeNull();
    useEditorStore.getState().undo();
    expect(useEditorStore.getState().building).toEqual(before);
  });
});
