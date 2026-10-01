import { describe, expect, it } from "vitest";
import { ghostColor } from "./ghost";

describe("ghostColor", () => {
  it("fades a colour toward the background, keeping a quarter even at opacity 0", () => {
    expect(ghostColor("#ff0000", "#ffffff", 1)).toBe("#ff0000");
    // Mixed in linear light, as three.js mixes colours: a quarter of black reads pale.
    expect(ghostColor("#000000", "#ffffff", 0)).toBe("#e1e1e1");
    // Out of range settings are held to 0..1.
    expect(ghostColor("#000000", "#ffffff", -2)).toBe(ghostColor("#000000", "#ffffff", 0));
  });
});
