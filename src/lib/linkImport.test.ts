import { describe, expect, it } from "vitest";
import { hashForJson, importFromHash, jsonFromHash } from "./linkImport";

describe("building in the link", () => {
  it("round-trips text with umlauts through the fragment", () => {
    const json = JSON.stringify({ name: "Wohngebäude Kreuzberg", n: 1.5 });
    const hash = hashForJson(json);
    expect(hash.startsWith("#import=")).toBe(true);
    expect(hash.slice("#import=".length)).not.toMatch(/[+/=]/);
    expect(jsonFromHash(hash)).toBe(json);
  });

  it("ignores other fragments and reports broken ones", () => {
    expect(importFromHash("", "en")).toBeNull();
    expect(importFromHash("#storey=2", "en")).toBeNull();
    expect(importFromHash("#import=%%%", "en")).toEqual({
      ok: false,
      error: { code: "invalidJson" },
    });
    const notBauwerk = importFromHash(hashForJson('{"format":"other"}'), "en");
    expect(notBauwerk?.ok).toBe(false);
  });
});
