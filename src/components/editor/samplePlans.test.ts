import { describe, expect, it } from "vitest";
import { samplePlanFor } from "./samplePlans";

const plans = { "/lod2/sample-plans/DEBE02YY40000BOo-EG.png": "/assets/boo-eg.png" };

describe("samplePlanFor", () => {
  it("offers the ground floor plan only on the ground floor of its building", () => {
    const boo = { id: "lod2-DEBE02YY40000BOo" };
    expect(samplePlanFor(boo, 0, plans)).toBe("/assets/boo-eg.png");
    expect(samplePlanFor(boo, 1, plans)).toBeNull();
    expect(samplePlanFor(boo, -1, plans)).toBeNull();
  });

  it("knows the building by its project's Gebäude-ID, whatever the building id became", () => {
    expect(samplePlanFor({ id: "b-123", project: { gid: "DEBE02YY40000BOo" } }, 0, plans)).toBe(
      "/assets/boo-eg.png",
    );
    expect(samplePlanFor({ id: "b-123" }, 0, plans)).toBeNull();
    expect(samplePlanFor({ id: "lod2-DEBE02YY40000Atr" }, 0, plans)).toBeNull();
  });

  it("finds the sample plans that come with the repository", () => {
    expect(samplePlanFor({ id: "lod2-DEBE02YY40000BOo" }, 0)).toMatch(/DEBE02YY40000BOo-EG/);
  });
});
