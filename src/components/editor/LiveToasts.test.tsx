import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { useAuth } from "@/auth/store";
import { exampleHouse } from "@/lib/examples";
import { useInbox } from "@/projects/inbox";
import { receiveActivity } from "@/sync/activity";
import { useEditorStore } from "@/store/building";
import { LiveToasts } from "./LiveToasts";
import { ACTIVITY_MS } from "./liveToasts";

vi.mock(import("@/projects/collab"), async (original) => ({
  ...(await original()),
  markRead: () => Promise.resolve(),
}));

const house = exampleHouse("en");
const ground = house.storeys[0]!;
const room = ground.rooms[0]!;

beforeEach(() => {
  vi.useFakeTimers();
  useEditorStore.getState().loadBuilding(house);
  useEditorStore.setState({ language: "en", projectId: "p1", selection: null });
  useAuth.setState({ status: "off", account: null });
  useInbox.setState({ items: [], unread: 0 });
});

afterEach(() => {
  vi.useRealTimers();
});

describe("live toasts", () => {
  it("show a mention that arrives, and Show selects the element the note is on", async () => {
    render(<LiveToasts />);
    act(() => {
      useInbox.setState({
        items: [
          {
            id: "n1",
            kind: "mentioned",
            projectId: "p1",
            projectName: "House",
            actor: { id: "u-anna", firstName: "Anna", lastName: "Becker", username: "anna" },
            payload: {
              text: "add walls",
              target: { kind: "room", storeyId: ground.id, id: room.id },
            },
            count: 1,
            createdAt: "2026-10-02T10:00:00Z",
            readAt: null,
          },
        ],
        unread: 1,
      });
    });
    expect(
      screen.getByText(`Anna Becker mentioned you on ${ground.name}, ${room.name}`),
    ).toBeTruthy();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Show" }));
      await Promise.resolve();
    });
    expect(useEditorStore.getState().selection).toEqual({
      kind: "room",
      storeyId: ground.id,
      id: room.id,
    });
    // Read now: the bell's count goes down.
    expect(useInbox.getState().unread).toBe(0);
  });

  it("show others' big changes for a few seconds, longer while the pointer is on them", () => {
    render(<LiveToasts />);
    act(() => {
      receiveActivity({
        actor: "Ben Keller",
        userId: "u-ben",
        activity: { kind: "restore", version: 8 },
      });
    });
    const toast = screen.getByText("Ben Keller restored version 8").closest("[role=status]")!;
    fireEvent.mouseEnter(toast);
    act(() => {
      vi.advanceTimersByTime(ACTIVITY_MS + 1000);
    });
    expect(screen.queryByText("Ben Keller restored version 8")).toBeTruthy();
    fireEvent.mouseLeave(toast);
    act(() => {
      vi.advanceTimersByTime(ACTIVITY_MS + 1000);
    });
    expect(screen.queryByText("Ben Keller restored version 8")).toBeNull();
  });

  it("never about this person's own doing, from another tab either", () => {
    useAuth.setState({
      status: "signedIn",
      account: { id: "u-me", username: "me", firstName: "Me", lastName: "Self" } as never,
    });
    render(<LiveToasts />);
    act(() => {
      receiveActivity({
        actor: "Me Self",
        userId: "u-me",
        activity: { kind: "restore", version: 3 },
      });
    });
    expect(screen.queryByText(/restored version/)).toBeNull();
  });
});
