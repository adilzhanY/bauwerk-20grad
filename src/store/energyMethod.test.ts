import { describe, expect, it } from "vitest";
import { AGE_IDS } from "@/geometry/ageDefaults";
import { computeEnergy } from "@/geometry/energy";
import { exampleAltbau } from "@/lib/examples";
import { createEditorStore } from "./building";

describe("energy method in the editor", () => {
  it("finds rooms again when a building is loaded, whatever areas it stored", () => {
    const store = createEditorStore();
    const b = exampleAltbau("en");
    const stale = {
      ...b,
      storeys: b.storeys.map((s) => ({ ...s, rooms: s.rooms.map((r) => ({ ...r, area: 1 })) })),
    };
    store.getState().loadBuilding(stale);
    for (const room of store.getState().building.storeys[0]?.rooms ?? [])
      expect(room.area).toBeGreaterThan(2);
    // Names and zones survive.
    expect(store.getState().building.storeys[0]?.rooms.map((r) => r.name)).toContain("Stairwell");
  });

  it("gives the envelope its age defaults in one undo step", () => {
    const store = createEditorStore();
    store.getState().loadBuilding(exampleAltbau("en"));
    const s = () => store.getState();
    const before = computeEnergy(s().building).transmissionLoss;
    s().applyAgeDefaults({
      year: 1905,
      wall: "brickSolidThick",
      window: "woodSingle",
      roofIsEnvelope: false,
    });
    const b = s().building;
    expect(b.wallConstructionId).toBe(AGE_IDS.wall);
    expect(b.yearBuilt).toBe(1905);
    expect(
      b.storeys
        .flatMap((st) => st.openings)
        .filter((o) => !o.interior && o.kind === "window")
        .every((o) => o.constructionId === AGE_IDS.window),
    ).toBe(true);
    expect(computeEnergy(b).transmissionLoss).not.toBeCloseTo(before);
    s().undo();
    expect(s().building.wallConstructionId).not.toBe(AGE_IDS.wall);
  });

  it("switches thermal bridges to ψ·l and the factors to 2027, and back", () => {
    const store = createEditorStore();
    store.getState().loadBuilding(exampleAltbau("en"));
    const s = () => store.getState();
    s().setEnergyMethod({ bridgeMethod: "detailed", factorSet: "gmodg2027" });
    expect(computeEnergy(s().building).bridgeMethod).toBe("detailed");
    expect(s().building.factorSet).toBe("gmodg2027");
    s().setEnergyMethod({ bridgeMethod: undefined, factorSet: undefined });
    expect("bridgeMethod" in s().building).toBe(false);
    expect(computeEnergy(s().building).bridgeMethod).toBe("flat");
  });
});
