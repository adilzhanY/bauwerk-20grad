import { afterEach, describe, expect, it, vi } from "vitest";
import { aiUnreachable, postInLine } from "./queue";

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

/**
 * A service that takes the upload (202), answers questions from `places` (a number of jobs
 * ahead, "done", or "missing" for a 404), then hands over `answer`.
 */
function service(places: (number | "done" | "missing")[], answer = new Response('{"walls":[]}')) {
  let jobId = "";
  const fetchMock = vi.fn((url: string, init?: RequestInit) => {
    if (url.startsWith("/floorplan/queue/")) {
      expect(url).toBe(`/floorplan/queue/${jobId}`);
      const place = places.shift() ?? "missing";
      if (place === "missing") return Promise.resolve(new Response("{}", { status: 404 }));
      return Promise.resolve(
        new Response(
          JSON.stringify(place === "done" ? { ahead: 0, done: true } : { ahead: place }),
        ),
      );
    }
    if (url.startsWith("/floorplan/result/")) {
      expect(url).toBe(`/floorplan/result/${jobId}`);
      return Promise.resolve(answer);
    }
    const headers = new Headers(init?.headers);
    jobId = headers.get("x-job-id") ?? "";
    expect(headers.get("prefer")).toBe("respond-async");
    return Promise.resolve(new Response('{"job":"x"}', { status: 202 }));
  });
  vi.stubGlobal("fetch", fetchMock);
  return { fetchMock, jobId: () => jobId };
}

describe("postInLine", () => {
  it("posts in the background, reports the jobs ahead, then collects the answer", async () => {
    vi.useFakeTimers();
    const { fetchMock, jobId } = service(["missing", 2, 1, 0, "done"]);
    const heard: number[] = [];
    const pending = postInLine("/floorplan", "/walls", new FormData(), undefined, (n) =>
      heard.push(n),
    );
    await vi.advanceTimersByTimeAsync(6000);
    const res = await pending;
    expect(jobId()).toMatch(/^[0-9a-f-]{36}$/);
    expect(heard).toEqual([2, 1, 0]);
    expect(await res.json()).toEqual({ walls: [] });
    const asked = fetchMock.mock.calls.length;
    await vi.advanceTimersByTimeAsync(5000);
    expect(fetchMock.mock.calls.length).toBe(asked);
  });

  it("returns a direct answer as it is, without asking", async () => {
    const fetchMock = vi.fn(() => Promise.resolve(new Response("{}", { status: 422 })));
    vi.stubGlobal("fetch", fetchMock);
    const res = await postInLine("/floorplan", "/walls", new FormData());
    expect(res.status).toBe(422);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("gives up on a job the service lost, as the AI being unreachable", async () => {
    vi.useFakeTimers();
    service([]);
    const pending = postInLine("/floorplan", "/walls", new FormData());
    await vi.advanceTimersByTimeAsync(31000);
    expect(aiUnreachable((await pending).status)).toBe(true);
  });

  it("stops waiting when stopped", async () => {
    vi.useFakeTimers();
    service([3, 3, 3, 3, 3]);
    const controller = new AbortController();
    const pending = postInLine("/floorplan", "/walls", new FormData(), controller.signal);
    const caught = pending.catch((e: unknown) => e);
    await vi.advanceTimersByTimeAsync(2500);
    controller.abort();
    expect(((await caught) as Error).name).toBe("AbortError");
  });

  it("knows the statuses of an AI that cannot be reached", () => {
    expect([502, 504, 522, 530].every(aiUnreachable)).toBe(true);
    expect([200, 404, 409, 422, 503].some(aiUnreachable)).toBe(false);
  });
});
