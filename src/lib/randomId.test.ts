import { afterEach, describe, expect, it, vi } from "vitest";
import { randomId } from "@/lib/ids";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("randomId", () => {
  it("works on plain http, where the browser has no crypto.randomUUID", () => {
    vi.stubGlobal("crypto", { getRandomValues: crypto.getRandomValues.bind(crypto) });
    const a = randomId();
    const b = randomId();
    expect(a).toMatch(/^[a-z0-9-]{12,}$/);
    expect(a).not.toBe(b);
  });
});
