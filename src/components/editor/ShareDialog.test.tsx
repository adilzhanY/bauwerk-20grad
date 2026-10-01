import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { useAuth } from "@/auth/store";
import { useEditorStore } from "@/store/building";
import { ShareDialog } from "@/components/editor/ShareDialog";

vi.mock("@/projects/collab", async (original) => ({
  ...(await original<typeof import("@/projects/collab")>()),
  listMembers: () => Promise.resolve([]),
  accessRequests: () => Promise.resolve([]),
  getLink: () => Promise.resolve(null),
  searchPeople: () =>
    Promise.resolve([{ id: "u2", username: "mia", firstName: "Mia", lastName: "Berg" }]),
  invite: () => Promise.reject(new Error("refused")),
}));

beforeEach(() => {
  useEditorStore.setState({ language: "en", projectId: "p1", projectRole: "owner" });
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
});
