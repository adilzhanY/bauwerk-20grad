import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { useEditorStore } from "@/store/building";
import { CompareDialog } from "@/components/editor/CompareDialog";
import { HistoryPanel } from "@/components/editor/HistoryPanel";

/** The server cannot be reached. */
vi.mock(import("@/sync/useSync"), async (original) => ({
  ...(await original()),
  fetchVersions: () => Promise.reject(new TypeError("Failed to fetch")),
  fetchVersion: () => Promise.reject(new TypeError("Failed to fetch")),
}));
vi.mock(import("@/projects/collab"), async (original) => ({
  ...(await original()),
  listNamed: () => Promise.reject(new TypeError("Failed to fetch")),
}));

beforeEach(() => {
  useEditorStore.setState({ language: "en", projectId: "p1", historyPreview: null });
});

describe("version history offline", () => {
  it("says the versions could not be loaded", async () => {
    render(<HistoryPanel />);
    expect(
      await screen.findByText("The versions could not be loaded. Try again in a moment."),
    ).toBeTruthy();
  });

  it("the comparison stops loading and says the version cannot be shown", async () => {
    render(<CompareDialog version={3} name="v3" onClose={() => undefined} />);
    expect(await screen.findByText("This version cannot be rebuilt.")).toBeTruthy();
    expect(screen.queryByText(/Loading/)).toBeNull();
  });
});
