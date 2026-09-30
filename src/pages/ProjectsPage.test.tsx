import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { useRouter } from "@/app/router";
import type { Building } from "@/geometry/types";
import { exampleAltbau, exampleHouse } from "@/lib/examples";
import { saveProjectCopy } from "@/lib/storage";
import { useEditorStore } from "@/store/building";
import { ProjectsPage } from "@/pages/ProjectsPage";

// The map needs WebGL, which jsdom does not have.
vi.mock("@/components/projects/ProjectsMap", () => ({ ProjectsMap: () => null }));

/** A project saved in this browser, under its own id. */
let nextId = 0;
const project = (b: Building, info: Building["project"]): Building => ({
  ...b,
  project: { ...info, localId: `p${String((nextId += 1))}` },
});

beforeEach(() => {
  localStorage.clear();
  useEditorStore.setState({ language: "en", projectId: null });
  useEditorStore.getState().loadBuilding(exampleHouse("en"));
});

describe("ProjectsPage without a server", () => {
  it("explains projects on the first visit and starts one from an example", async () => {
    const navigate = vi.fn();
    useRouter.setState({ navigate });
    render(<ProjectsPage />);
    expect(await screen.findByText("No projects yet")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Methfesselstraße 8" }));
    expect(navigate).toHaveBeenCalledWith(
      { page: "building", gid: "DEBE02YY40000BOo" },
      { query: "?neu=1" },
    );
  });

  it("shows each kept project as a card, filters by stage, searches, and opens one", async () => {
    const navigate = vi.fn();
    useRouter.setState({ navigate });
    const altbau = project(
      { ...exampleAltbau("en"), scenarios: [] },
      {
        address: "Methfesselstraße 8",
        client: "Familie Krüger",
      },
    );
    const house = project(
      { ...exampleHouse("en"), scenarios: [{ id: "s", name: "Scenario 1", overrides: {} }] },
      { address: "Methfesselstraße 6", client: "WEG 6" },
    );
    saveProjectCopy(altbau);
    saveProjectCopy(house);
    render(<ProjectsPage />);

    expect(await screen.findByText("Methfesselstraße 8")).toBeTruthy();
    expect(screen.getByText("Methfesselstraße 6")).toBeTruthy();
    expect(screen.getByText(/Familie Krüger/)).toBeTruthy();

    // One project is at its variants (a saved scenario), the other still at its survey.
    fireEvent.click(screen.getByRole("button", { name: /Variants\s*1/ }));
    expect(screen.queryByText("Methfesselstraße 8")).toBeNull();
    expect(screen.getByText("Methfesselstraße 6")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /All\s*2/ }));

    fireEvent.change(screen.getByPlaceholderText("Search address, client, use"), {
      target: { value: "krüger" },
    });
    expect(screen.queryByText("Methfesselstraße 6")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Open Methfesselstraße 8" }));
    await waitFor(() => {
      expect(useEditorStore.getState().building.id).toBe(altbau.id);
    });
    // No Gebäude-ID, so no survey page; the model has windows, so its first open step is Variants.
    expect(navigate).toHaveBeenCalledWith({ page: "variants" }, { query: "" });
  });

  it("deletes a project after a second click", async () => {
    saveProjectCopy(project(exampleAltbau("en"), { address: "Methfesselstraße 4" }));
    render(<ProjectsPage />);
    const card = (await screen.findByText("Methfesselstraße 4")).closest("article");
    if (!card) throw new Error("no card");
    fireEvent.click(within(card).getByRole("button", { name: "Delete project" }));
    fireEvent.click(within(card).getByRole("button", { name: "Delete?" }));
    expect(await screen.findByText("No projects yet")).toBeTruthy();
  });
});
