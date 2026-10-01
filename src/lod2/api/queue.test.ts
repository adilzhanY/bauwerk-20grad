import { afterEach, describe, expect, it, vi } from "vitest";
import { postInLine } from "./queue";

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("postInLine", () => {
  it("sends a job id, reports the jobs ahead while waiting, and stops asking once answered", async () => {
    vi.useFakeTimers();
    const places = [404, 2, 1, 0];
    let answer: (res: Response) => void = () => undefined;
    let jobId = "";
    const fetchMock = vi.fn((url: string, init?: RequestInit) => {
      if (url.startsWith("/vision/queue/")) {
        expect(url).toBe(`/vision/queue/${jobId}`);
        const place = places.shift() ?? 0;
        return Promise.resolve(
          place === 404
            ? new Response("{}", { status: 404 })
            : new Response(JSON.stringify({ ahead: place })),
        );
      }
      jobId = new Headers(init?.headers).get("x-job-id") ?? "";
      return new Promise<Response>((resolve) => (answer = resolve));
    });
    vi.stubGlobal("fetch", fetchMock);
    const heard: number[] = [];
    const pending = postInLine("/vision", "/openings", new FormData(), undefined, (n) =>
      heard.push(n),
    );
    // The upload goes out once the sign-in headers are read.
    await vi.advanceTimersByTimeAsync(0);
    expect(jobId).toMatch(/^[0-9a-f-]{36}$/);
    await vi.advanceTimersByTimeAsync(4000);
    expect(heard).toEqual([2, 1, 0]);
    answer(new Response("{}"));
    expect((await pending).ok).toBe(true);
    const asked = fetchMock.mock.calls.length;
    await vi.advanceTimersByTimeAsync(5000);
    expect(fetchMock.mock.calls.length).toBe(asked);
  });
});
