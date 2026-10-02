import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { exampleHouse } from "@/lib/examples";
import { resetIds } from "@/lib/ids";
import { PLAN_REVEAL_MS } from "@/scene/planReveal";
import { useEditorStore } from "@/store/building";
import { PdfImportDialog } from "./PdfImportDialog";

/** What lod2-floorplan answered for the ground floor plan of BOo. */
const reading = readFileSync(
  join(__dirname, "../../../lod2/sample-plans/DEBE02YY40000BOo-EG.walls.json"),
  "utf8",
);

/** A PDF of two pages, the upper floor first: the titles say which storey each shows. */
vi.mock("@/lib/pdfPages", () => ({
  isPdf: () => true,
  pdfPages: () =>
    Promise.resolve([
      { image: new Blob(["p1"]), width: 800, height: 600, text: "Grundriss 1. Obergeschoss" },
      { image: new Blob(["p2"]), width: 800, height: 600, text: "Grundriss Erdgeschoss" },
    ]),
}));

let urls = 0;
beforeEach(() => {
  resetIds();
  useEditorStore.setState({ language: "en" });
  useEditorStore.getState().loadBuilding(exampleHouse("en"));
  vi.stubGlobal(
    "URL",
    Object.assign(URL, {
      createObjectURL: () => `blob:page-${String(++urls)}`,
      revokeObjectURL: () => undefined,
    }),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("floor plans from a PDF", () => {
  it("puts each page on the storey it names, reads them one at a time and applies them all", async () => {
    let reading_ = 0;
    let most = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (url.endsWith("/health")) return Response.json({ roomModel: true });
        reading_++;
        most = Math.max(most, reading_);
        await new Promise((resolve) => setTimeout(resolve, 5));
        reading_--;
        return new Response(reading, { headers: { "content-type": "application/json" } });
      }),
    );
    const [ground, first] = useEditorStore.getState().building.storeys;
    if (!ground || !first) throw new Error("the example has two storeys");
    const onClose = vi.fn();
    render(<PdfImportDialog file={new File(["%PDF"], "plans.pdf")} onClose={onClose} />);

    // Page 1 is the upper floor, page 2 the ground floor, from their titles.
    const page1 = await screen.findByRole("combobox", { name: "Storey for page 1" });
    expect(page1.textContent).toContain(first.name);
    expect(screen.getByRole("combobox", { name: "Storey for page 2" }).textContent).toContain(
      ground.name,
    );

    fireEvent.click(await screen.findByRole("button", { name: "Read 2 floor plans" }));
    await vi.waitFor(
      () => {
        expect(screen.getAllByText("6 walls, 8 doors")).toHaveLength(2);
      },
      { timeout: 3000 },
    );
    // One job at a time on the graphics card.
    expect(most).toBe(1);

    // Both pages with their walls drawn over them, and one way on.
    expect(screen.getByText("12 walls and 16 doors found on 2 pages")).toBeTruthy();
    vi.useFakeTimers();
    try {
      fireEvent.click(screen.getByRole("button", { name: "Apply to all floors" }));
      // The dialog closes so the floors can be seen arriving, one after another, each in
      // the plan view of its storey.
      expect(onClose).toHaveBeenCalled();
      vi.advanceTimersByTime(0);
      let state = useEditorStore.getState();
      expect(state.floorPlanImages[first.id]?.url).toBe("blob:page-1");
      expect(state.floorPlanImages[ground.id]).toBeUndefined();
      expect(state.activeStoreyId).toBe(first.id);
      expect(state.planView).toBe(true);
      vi.advanceTimersByTime(PLAN_REVEAL_MS + 400);
      state = useEditorStore.getState();
      expect(state.floorPlanImages[ground.id]?.url).toBe("blob:page-2");
      expect(state.activeStoreyId).toBe(ground.id);
      expect(state.building.storeys[0]?.interiorWalls.length).toBeGreaterThan(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it("can keep the pages as floor plans without reading them", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.resolve(new Response(null, { status: 502 }))),
    );
    const [ground] = useEditorStore.getState().building.storeys;
    render(<PdfImportDialog file={new File(["%PDF"], "plans.pdf")} onClose={() => undefined} />);
    fireEvent.click(await screen.findByRole("button", { name: "Add the pages as floor plans" }));
    const after = useEditorStore.getState();
    expect(after.floorPlanImages[ground?.id ?? ""]).toBeTruthy();
    expect(after.building.storeys[0]?.interiorWalls.length).toBe(ground?.interiorWalls.length);
  });
});
