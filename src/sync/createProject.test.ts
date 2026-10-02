import { afterEach, describe, expect, it, vi } from "vitest";
import { createProject, lastCreateFailure } from "./useSync";

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

function answers(...replies: (number | "down")[]) {
  const fetchMock = vi.fn(() => {
    const reply = replies.shift() ?? 500;
    if (reply === "down") return Promise.reject(new TypeError("Failed to fetch"));
    const body = reply === 201 ? '{"id":"p1"}' : "{}";
    return Promise.resolve(new Response(body, { status: reply }));
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

describe("createProject", () => {
  it("tries again while the server restarts, then saves", async () => {
    vi.stubEnv("VITE_API_URL", "/collab");
    vi.useFakeTimers();
    const fetchMock = answers("down", 502, 201);
    const pending = createProject();
    await vi.advanceTimersByTimeAsync(5000);
    expect(await pending).toBe("p1");
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(lastCreateFailure()).toBeNull();
  });

  it("gives up after five tries, about 17 seconds, and says the server could not save it", async () => {
    vi.stubEnv("VITE_API_URL", "/collab");
    vi.useFakeTimers();
    const fetchMock = answers(503, 503, 503, 503, 503, 503);
    const pending = createProject();
    await vi.advanceTimersByTimeAsync(20000);
    expect(await pending).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(5);
    expect(lastCreateFailure()).toBe("server");
  });

  it("does not try again when the sign in ran out or the building is refused", async () => {
    vi.stubEnv("VITE_API_URL", "/collab");
    answers(401);
    expect(await createProject()).toBeNull();
    expect(lastCreateFailure()).toBe("signIn");
    const fetchMock = answers(400);
    expect(await createProject()).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(lastCreateFailure()).toBe("server");
  });
});
