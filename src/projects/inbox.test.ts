import { afterEach, describe, expect, it, vi } from "vitest";
import type * as Collab from "./collab";

vi.mock("./collab", async (actual) => ({
  ...(await actual<typeof Collab>()),
  markRead: vi.fn(() => Promise.resolve()),
}));

afterEach(() => {
  vi.resetModules();
});

const notice = (id: string, readAt: string | null = null) => ({
  id,
  kind: "mentioned",
  projectId: "p1",
  projectName: "BOo",
  actor: null,
  payload: {},
  count: 1,
  createdAt: "2026-10-01T10:00:00.000Z",
  readAt,
});

describe("the inbox", () => {
  it("counts an item once even when it folds again, and reading lowers the count", async () => {
    const { readNotices, useInbox } = await import("./inbox");
    const { markRead } = await import("./collab");
    useInbox.setState({ items: [notice("a"), notice("b", "2026-10-01T09:00:00.000Z")], unread: 1 });
    await readNotices(["a", "b"]);
    expect(useInbox.getState().unread).toBe(0);
    expect(markRead).toHaveBeenCalledWith(["a", "b"]);
    // Nothing unread left: nothing sent.
    await readNotices("all");
    expect(markRead).toHaveBeenCalledTimes(1);
  });
});
