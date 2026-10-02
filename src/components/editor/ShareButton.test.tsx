import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";

afterEach(() => {
  // Unmount before the stand-ins go, so nothing still pending runs against the real globals.
  cleanup();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.resetModules();
  window.history.replaceState(null, "", "/editor");
});

/** The button as the app would load it, with or without a collaboration server. */
async function load(apiUrl: string | undefined) {
  if (apiUrl) vi.stubEnv("VITE_API_URL", apiUrl);
  vi.resetModules();
  const button = (await import("@/components/editor/ShareButton")).ShareButton;
  // These tests are about a server without accounts.
  (await import("@/auth/store")).useAuth.setState({ status: "off", account: null });
  return button;
}

describe("ShareButton", () => {
  it("is not there when the app was built without a server", async () => {
    const ShareButton = await load(undefined);
    render(<ShareButton />);
    expect(screen.queryByRole("button", { name: "Share" })).toBeNull();
  });

  it("makes the building a project and shows the link to send", async () => {
    const fetchMock = vi.fn(() =>
      Promise.resolve(new Response(JSON.stringify({ id: "p-123" }), { status: 201 })),
    );
    vi.stubGlobal("fetch", fetchMock);
    const ShareButton = await load("/collab");
    render(<ShareButton />);
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Share" }));
      await Promise.resolve();
    });
    expect(fetchMock).toHaveBeenCalledWith(
      "/collab/projects",
      expect.objectContaining({ method: "POST" }),
    );
    expect(window.location.search).toBe("?project=p-123");
    expect(await screen.findByRole("dialog")).toBeTruthy();
    expect(screen.getByText(/\?project=p-123/)).toBeTruthy();
  });

  it("says so when the server does not answer, after trying again for about 17 seconds", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const fetchMock = vi.fn(() => Promise.reject(new Error("down")));
    vi.stubGlobal("fetch", fetchMock);
    const ShareButton = await load("/collab");
    render(<ShareButton />);
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Share" }));
      // A deploy restarts the server for about 15 seconds: four more tries, 1.5 to 8 s apart.
      await vi.advanceTimersByTimeAsync(20000);
    });
    expect(await screen.findByText(/does not answer/)).toBeTruthy();
    expect(fetchMock).toHaveBeenCalledTimes(5);
    expect(window.location.search).toBe("");
    vi.useRealTimers();
  });
});
