import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { useRouter } from "@/app/router";
import { projectSummary } from "@/geometry/project";
import { exampleHouse } from "@/lib/examples";
import type { ProjectCard } from "@/projects/projects";
import type * as Projects from "@/projects/projects";
import type * as Session from "@/projects/session";
import { useEditorStore } from "@/store/building";
import { ProjectsPage } from "@/pages/ProjectsPage";

vi.mock("@/components/projects/ProjectsMap", () => ({ ProjectsMap: () => null }));

const building = { ...exampleHouse("en"), project: { address: "Methfesselstraße 8" } };
const card: ProjectCard = {
  ref: { kind: "server", id: "2afa34ef-14bf-4aa9-8332-c5db3f10f07b" },
  buildingId: building.id,
  summary: projectSummary(building),
  updatedAt: new Date().toISOString(),
  owner: null,
  here: [],
  lastSeenAt: null,
};

vi.mock("@/projects/projects", async (original) => ({
  ...(await original<typeof Projects>()),
  listProjectCards: () => Promise.resolve([card]),
  cardPicture: () => Promise.resolve(null),
}));
vi.mock("@/projects/session", async (original) => ({
  ...(await original<typeof Session>()),
  openProjectCard: () => Promise.resolve("opened"),
}));

describe("opening a server project from its card", () => {
  it("keeps the project in the address, so a reload or a copied link opens it again", async () => {
    const navigate = vi.fn();
    useRouter.setState({ navigate });
    useEditorStore.setState({ language: "en" });
    render(<ProjectsPage />);
    fireEvent.click(await screen.findByRole("button", { name: /Methfesselstraße 8/ }));
    await vi.waitFor(() => {
      expect(navigate).toHaveBeenCalled();
    });
    expect(navigate.mock.calls[0]?.[1]).toEqual({
      query: "?project=2afa34ef-14bf-4aa9-8332-c5db3f10f07b",
    });
  });
});
