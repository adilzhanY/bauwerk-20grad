import { afterEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.resetModules();
  window.history.replaceState(null, "", "/editor");
});

/** The button as the app would load it, with or without a collaboration server. */
async function load(apiUrl: string | undefined) {
  if (apiUrl) vi.stubEnv("VITE_API_URL", apiUrl);
  vi.resetModules();
  return (await import("./ShareButton")).ShareButton;
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

  it("says so when the server does not answer", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.reject(new Error("down"))),
    );
    const ShareButton = await load("/collab");
    render(<ShareButton />);
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Share" }));
      await Promise.resolve();
    });
    expect(await screen.findByText(/does not answer/)).toBeTruthy();
    expect(window.location.search).toBe("");
  });
});
