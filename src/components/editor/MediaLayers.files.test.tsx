import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { exampleHouse } from "@/lib/examples";
import { resetIds } from "@/lib/ids";
import { useEditorStore } from "@/store/building";
import { useProjectFiles } from "@/projects/files";
import { MediaLayers } from "@/components/editor/MediaLayers";

const removed: string[] = [];
vi.mock(import("@/projects/files"), async (original) => ({
  ...(await original()),
  reloadFiles: () => Promise.resolve(),
  removeFile: (_project: string, id: string) => {
    removed.push(id);
    return Promise.resolve();
  },
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
  useEditorStore.setState({ language: "en", projectId: "p1", projectRole: "owner" });
  useEditorStore.getState().loadBuilding(exampleHouse("en"));
  useProjectFiles.setState({ projectId: "p1", files: [file], failed: false });
});

describe("files in the layers tree", () => {
  it("deletes a file from its row after a second click, as the Files tab did", () => {
    render(
      <ul>
        <MediaLayers onPreview={() => undefined} />
      </ul>,
    );
    fireEvent.click(screen.getByRole("button", { name: /^Photos and files/ }));
    fireEvent.click(screen.getByRole("button", { name: /^Files/ }));
    fireEvent.click(screen.getByRole("button", { name: "Delete offer.pdf" }));
    expect(removed).toEqual([]);
    const confirm = screen.getByRole("button", { name: "Delete for everyone?" });
    expect(confirm.getAttribute("aria-pressed")).toBe("true");
    fireEvent.click(confirm);
    expect(removed).toEqual(["f1"]);
  });

  it("offers no delete to a viewer", () => {
    useEditorStore.setState({ projectRole: "viewer" });
    render(
      <ul>
        <MediaLayers onPreview={() => undefined} />
      </ul>,
    );
    fireEvent.click(screen.getByRole("button", { name: /^Photos and files/ }));
    fireEvent.click(screen.getByRole("button", { name: /^Files/ }));
    expect(screen.getByRole("button", { name: /^offer\.pdf/ })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Delete offer.pdf" })).toBeNull();
  });
});
