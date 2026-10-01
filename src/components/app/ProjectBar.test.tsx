import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { exampleHouse } from "@/lib/examples";
import { useEditorStore } from "@/store/building";
import { ProjectBar } from "@/components/app/ProjectBar";
import { useRouter } from "@/app/router";

beforeEach(() => {
  useEditorStore.setState({ language: "en" });
  useEditorStore.getState().loadBuilding({
    ...exampleHouse("en"),
    scenarios: [{ id: "s", name: "Scenario 1", overrides: {} }],
    project: { gid: "DEBE02YY40000BOo", address: "Methfesselstraße 8" },
  });
});

describe("ProjectBar", () => {
  it("shows the building, the steps done, and goes to a step", () => {
    const navigate = vi.fn();
    useRouter.setState({ route: { page: "editor" }, navigate });
    render(<ProjectBar />);
    expect(screen.getByText("Methfesselstraße 8")).toBeTruthy();
    expect(screen.getByRole("button", { name: /Model/ }).getAttribute("aria-current")).toBe("step");

    fireEvent.click(screen.getByRole("button", { name: /Survey/ }));
    expect(navigate).toHaveBeenCalledWith({ page: "building", gid: "DEBE02YY40000BOo" });
    fireEvent.click(screen.getByRole("button", { name: /Variants/ }));
    expect(navigate).toHaveBeenCalledWith({ page: "variants" });
    fireEvent.click(screen.getByRole("button", { name: /Projects/ }));
    expect(navigate).toHaveBeenCalledWith({ page: "projects" }, { query: "" });
  });

  it("marks the project done and reopens it; nothing else about the stage is set by hand", () => {
    useRouter.setState({ route: { page: "editor" } });
    render(<ProjectBar />);
    // No stage picker that looks like the step buttons beside it.
    expect(screen.queryByRole("combobox", { name: "Stage" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Mark as done" }));
    expect(useEditorStore.getState().building.project?.stage).toBe("done");
    fireEvent.click(screen.getByRole("button", { name: "Reopen" }));
    expect(useEditorStore.getState().building.project).not.toHaveProperty("stage");
    expect(useEditorStore.getState().building.project?.address).toBe("Methfesselstraße 8");
    // Still on the same step: these buttons change the project, not the page.
    expect(useRouter.getState().route).toEqual({ page: "editor" });
  });
});
