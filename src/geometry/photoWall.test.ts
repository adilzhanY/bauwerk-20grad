import { beforeEach, describe, expect, it } from "vitest";
import type { MeasuredOpening } from "lod2-core/survey";
import { exampleHouse } from "@/lib/examples";
import { resetIds } from "@/lib/ids";
import { diffBuilding } from "@/sync/ops";
import { validateBuilding } from "./export";
import { planWallOpenings, wallPlaneFor } from "./photoWall";
import type { Building } from "./types";

const photo = () => ({ kind: "photo" as const, note: "test" });

/** The house's front wall (edge 0, 10 m) as a photo would measure it: from the ground up. */
function measuredFront(b: Building): MeasuredOpening[] {
  const ground = b.storeys[0]?.height ?? 0;
  return [
    { kind: "window", x: 1, y: 0.9, width: 1.2, height: 1.4, score: 0.93 },
    { kind: "door", x: 4.5, y: 0.1, width: 1, height: 2.0, score: 0.9 },
    { kind: "window", x: 7.3, y: 0.9, width: 1.2, height: 1.4, score: 0.95 },
    // Upper floor.
    { kind: "window", x: 2, y: ground + 0.9, width: 1.2, height: 1.3, score: 0.88 },
  ];
}

beforeEach(() => {
  resetIds();
});

describe("wallPlaneFor", () => {
  it("stands on the footprint edge, as wide as the edge and as high as the eaves", () => {
    const b = exampleHouse("en");
    const plane = wallPlaneFor(b, 0);
    const eaves = b.storeys.reduce((sum, s) => sum + s.height, 0);
    expect(plane).toMatchObject({ width: 10, height: eaves });
    // Edge 0 runs east along the south side of a counter-clockwise footprint: it faces south.
    expect(plane?.azimuth).toBeCloseTo(180);
    expect(wallPlaneFor(b, 99)).toBeNull();
  });
});

describe("planWallOpenings", () => {
  it("puts each measured opening on its storey, keeps the ones already there and adds the rest", () => {
    const b = exampleHouse("en");
    const plan = planWallOpenings(b, 0, measuredFront(b), photo);
    if (!plan) throw new Error("no plan");
    expect(plan.dropped).toEqual([]);
    const count = (change: string) => plan.changes.filter((c) => c.change === change).length;
    // The door, measured 10 cm up, stands on the floor as before; one window sits 20 cm left.
    expect(count("kept")).toBe(2);
    expect(count("moved")).toBe(1);
    expect(plan.changes.find((c) => c.change === "moved")?.opening.offset).toBe(7.3);
    expect(count("added")).toBe(1);
    const door = plan.changes.find((c) => c.opening.kind === "door");
    expect(door?.opening).toMatchObject({ sill: 0, height: 2.1 });
    const upper = plan.changes.find((c) => c.change === "added");
    expect(upper?.storeyId).toBe(b.storeys[1]?.id);
    expect(upper?.opening.sill).toBeCloseTo(0.9);
    // Everything else on the building is untouched, and the result is valid.
    expect(plan.building.storeys[0]?.openings.filter((o) => o.wallIndex !== 0)).toEqual(
      b.storeys[0]?.openings.filter((o) => o.wallIndex !== 0),
    );
    expect(validateBuilding(plan.building)).toBeNull();
    expect(plan.building.sources?.[`opening:${upper?.opening.id ?? ""}`]).toMatchObject({
      kind: "photo",
    });
  });

  it("removes the wall's openings the photo does not show, on every storey", () => {
    const b = exampleHouse("en");
    const onFront = b.storeys.flatMap((s) => s.openings.filter((o) => o.wallIndex === 0));
    const plan = planWallOpenings(b, 0, measuredFront(b).slice(0, 1), photo);
    const removed = plan?.changes.filter((c) => c.change === "removed") ?? [];
    expect(removed).toHaveLength(onFront.length - 1);
    const left = plan?.building.storeys.flatMap((s) => s.openings.filter((o) => o.wallIndex === 0));
    expect(left).toHaveLength(1);
  });

  it("changes nothing when the same photo is applied twice", () => {
    const b = exampleHouse("en");
    const once = planWallOpenings(b, 0, measuredFront(b), photo);
    if (!once) throw new Error("no plan");
    const twice = planWallOpenings(once.building, 0, measuredFront(b), photo);
    expect(twice?.changes.every((c) => c.change === "kept")).toBe(true);
    expect(diffBuilding(once.building, twice?.building)).toEqual([]);
  });

  it("reports an opening above the eaves and trims one that reaches through a slab", () => {
    const b = exampleHouse("en");
    const eaves = b.storeys.reduce((sum, s) => sum + s.height, 0);
    const ground = b.storeys[0]?.height ?? 0;
    const plan = planWallOpenings(
      b,
      0,
      [
        { kind: "window", x: 2, y: eaves + 0.5, width: 1, height: 1 },
        { kind: "window", x: 6, y: ground - 0.4, width: 1, height: 1.6 },
      ],
      photo,
    );
    if (!plan) throw new Error("no plan");
    expect(plan.dropped.map((d) => d.index)).toEqual([0]);
    const trimmed = plan.changes.find((c) => c.change === "added");
    expect(trimmed?.notes.length).toBeGreaterThan(0);
    expect(validateBuilding(plan.building)).toBeNull();
  });
});
