import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { useAuth } from "@/auth/store";
import type { ProjectFile } from "@/projects/collab";
import { useEditorStore } from "@/store/building";
import { ThreadsSection } from "@/components/editor/ThreadsSection";

/** Uploads wait until the test lets them finish, in any order. */
const fake = vi.hoisted(() => ({
  uploads: [] as ((file: unknown) => void)[],
  started: [] as string[][],
  members: [] as unknown[],
}));

vi.mock(import("@/projects/collab"), async (original) => ({
  ...(await original()),
  listMembers: () => Promise.resolve(fake.members as never),
  listFiles: () => Promise.resolve([]),
  uploadFile: () =>
    new Promise<ProjectFile>((resolve) => {
      fake.uploads.push(resolve as (file: unknown) => void);
    }),
  startThread: (_p: string, _t: unknown, _text: string, attachments: string[] = []) => {
    fake.started.push(attachments);
    return Promise.resolve({ id: "t1" });
  },
}));
vi.mock(import("@/projects/threads"), async (original) => ({
  ...(await original()),
  reloadThreads: () => Promise.resolve(),
}));

const stored = (id: string): ProjectFile => ({
  id,
  slot: null,
  name: `${id}.pdf`,
  mime: "application/pdf",
  size: 1,
  width: null,
  height: null,
  uploadedBy: null,
  createdAt: "2026-10-01T00:00:00Z",
});

beforeEach(() => {
  fake.uploads = [];
  fake.started = [];
  fake.members = [];
  useEditorStore.setState({ language: "en", projectId: "p1", projectRole: "editor" });
  useAuth.setState({ status: "off", account: null });
});

describe("a note with attachments", () => {
  it("keeps both of two quick uploads and cannot be sent until they are up", async () => {
    render(<ThreadsSection target={{ kind: "building" }} />);
    fireEvent.change(screen.getByRole("textbox", { name: "Start a note" }), {
      target: { value: "See the plans" },
    });
    // The paperclip opens the upload dialog: two files chosen at once go up side by side.
    fireEvent.click(screen.getByRole("button", { name: "Attach a file" }));
    const input = await screen.findByLabelText("Choose from your computer", { selector: "input" });
    fireEvent.change(input, {
      target: { files: [new File(["a"], "a.pdf"), new File(["b"], "b.pdf")] },
    });
    const send = screen.getByRole("button", { name: "Send" });
    expect(send).toHaveProperty("disabled", true);

    await act(async () => {
      fake.uploads[0]?.(stored("a"));
      fake.uploads[1]?.(stored("b"));
      await Promise.resolve();
    });
    expect(screen.getByText("Attached: a.pdf")).toBeTruthy();
    expect(screen.getByText("Attached: b.pdf")).toBeTruthy();
    expect(send).toHaveProperty("disabled", false);
    await act(async () => {
      fireEvent.click(send);
      await Promise.resolve();
    });
    expect(fake.started).toEqual([["a", "b"]]);
  });
});

describe("mentions while typing", () => {
  it("colours a member's whole @username in the box at once, and nothing else", async () => {
    fake.members = [
      {
        userId: "u-lena",
        username: "lena_b",
        firstName: "Lena",
        lastName: "Berg",
        role: "editor",
        joinedAt: "2026-10-01T00:00:00Z",
        lastSeenAt: null,
        invitedBy: null,
      },
    ];
    const { container } = render(<ThreadsSection target={{ kind: "building" }} />);
    await act(async () => {
      await Promise.resolve();
    });
    const box = screen.getByRole("textbox", { name: "Start a note" });
    const marked = () =>
      [...container.querySelectorAll("[aria-hidden] span[style]")].map((e) => e.textContent);
    fireEvent.change(box, { target: { value: "@len" } });
    expect(marked()).toEqual([]);
    fireEvent.change(box, { target: { value: "@Lena_B add walls here, @nobody too" } });
    expect(marked()).toEqual(["@Lena_B"]);
    // The browser's spell check would underline the name: off while names are coloured.
    expect(box.getAttribute("spellcheck")).toBe("false");
  });
});
