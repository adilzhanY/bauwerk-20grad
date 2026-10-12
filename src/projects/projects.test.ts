import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The module reads VITE_API_URL when it loads, so each test loads it fresh.
beforeEach(() => {
  vi.stubEnv("VITE_API_URL", "/collab");
  vi.resetModules();
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("server pictures", () => {
  it("a refused save or removal fails, so it is tried again", async () => {
    vi.stubGlobal("fetch", () => Promise.resolve(new Response(null, { status: 401 })));
    const { removePhoto, savePhoto } = await import("./projects");
    const ref = { kind: "server", id: "p1" } as const;
    await expect(savePhoto(ref, "0", new Blob(["x"]), 10, 10)).rejects.toThrow();
    await expect(removePhoto(ref, "0")).rejects.toThrow();
  });
});
