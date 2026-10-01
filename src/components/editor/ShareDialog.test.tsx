import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { useAuth } from "@/auth/store";
import { useEditorStore } from "@/store/building";
import { ShareDialog } from "@/components/editor/ShareDialog";

const people = vi.hoisted(() => ({ members: [] as unknown[] }));

vi.mock(import("@/projects/collab"), async (original) => ({
  ...(await original()),
  listMembers: () => Promise.resolve(people.members as never),
  accessRequests: () => Promise.resolve([]),
  getLink: () => Promise.resolve(null),
  searchPeople: () =>
    Promise.resolve([{ id: "u2", username: "mia", firstName: "Mia", lastName: "Berg" }]),
  invite: () => Promise.reject(new Error("refused")),
}));

beforeEach(() => {
  people.members = [];
  useEditorStore.setState({ language: "en", projectId: "p1", projectRole: "owner", presence: [] });
  useAuth.setState({
    status: "signedIn",
    account: { id: "u1", username: "me", firstName: "Me", lastName: "Here", color: "#123456" },
  });
});

describe("sharing", () => {
  it("a refused invite says so and is not shown as invited", async () => {
    render(<ShareDialog onClose={() => undefined} />);
    fireEvent.change(screen.getByRole("textbox", { name: "Invite people" }), {
      target: { value: "mia" },
    });
    const invite = await screen.findByRole("button", { name: "Invite" });
    await act(async () => {
      fireEvent.click(invite);
      await Promise.resolve();
    });
    expect(await screen.findByText("That did not work. Try again.")).toBeTruthy();
    expect(screen.queryByText("Invited")).toBeNull();
    expect(screen.getByRole("button", { name: "Invite" })).toBeTruthy();
  });

  it("says you are here, not when you were last here", async () => {
    const member = (userId: string, firstName: string) => ({
      userId,
      username: firstName.toLowerCase(),
      firstName,
      lastName: "Berg",
      role: "editor",
      joinedAt: "2026-09-01T10:00:00Z",
      lastSeenAt: new Date(Date.now() - 8 * 60_000).toISOString(),
      invitedBy: null,
    });
    people.members = [{ ...member("u1", "Me"), role: "owner" }, member("u2", "Mia")];
    render(<ShareDialog onClose={() => undefined} />);
    expect(await screen.findByText(/@me · Here now/)).toBeTruthy();
    // Someone else who is not in the project now keeps their time.
    expect(screen.getByText(/@mia · last here 8 minutes ago/)).toBeTruthy();
  });
});
