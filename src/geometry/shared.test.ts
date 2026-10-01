import { buildingHeatLoad } from "./hvac";
import { buildingFromBox } from "./box";
import { computeEnergy } from "./energy";
import { describe, expect, it } from "vitest";
import { placeAfterSplit, remapEdgeIndex, sharedAfterRemove, sharedAfterSplit } from "./shared";

describe("shared edges under footprint edits", () => {
  it("shifts later edges up and keeps both halves of a split shared edge", () => {
    expect(sharedAfterSplit([0, 2], 1)).toEqual([0, 3]);
    expect(sharedAfterSplit([1], 1)).toEqual([1, 2]);
  });

  it("merges the two edges at a removed vertex, shared only when both were", () => {
    // Square with edges 0..3, remove vertex 2: edges 1 and 2 merge into edge 1.
    expect(sharedAfterRemove([1, 2], 2, 4)).toEqual([1]);
    expect(sharedAfterRemove([1], 2, 4)).toEqual([]);
    expect(sharedAfterRemove([3], 2, 4)).toEqual([2]);
    // Removing vertex 0 merges the last edge with edge 0 into the new last edge.
    expect(sharedAfterRemove([3, 0], 0, 4)).toEqual([2]);
  });
});

describe("items on a split edge", () => {
  it("keeps items before the split, moves items after it, drops items across it", () => {
    expect(placeAfterSplit(0, 1, 1, 1, 5)).toEqual({ wallIndex: 0, offset: 1 });
    expect(placeAfterSplit(2, 1, 1, 1, 5)).toEqual({ wallIndex: 3, offset: 1 });
    expect(placeAfterSplit(1, 1, 2, 1, 5)).toEqual({ wallIndex: 1, offset: 1 });
    expect(placeAfterSplit(1, 6, 2, 1, 5)).toEqual({ wallIndex: 2, offset: 1 });
    expect(placeAfterSplit(1, 4, 2, 1, 5)).toBeNull();
  });
});

describe("edge index bookkeeping edge cases", () => {
  it("splits the last edge without touching the others", () => {
    expect(sharedAfterSplit([0, 3], 3)).toEqual([0, 3, 4]);
    expect(placeAfterSplit(3, 6, 1, 3, 5)).toEqual({ wallIndex: 4, offset: 1 });
  });

  it("removes a vertex from a building without shared walls", () => {
    expect(sharedAfterRemove([], 1, 4)).toEqual([]);
  });
});

describe("remapEdgeIndex", () => {
  it("after a split: earlier edges stay, the split edge is its first half, later edges move up", () => {
    const split = { kind: "split", edge: 1 } as const;
    expect(remapEdgeIndex(0, split)).toEqual({ index: 0, same: true });
    expect(remapEdgeIndex(1, split)).toEqual({ index: 1, same: false });
    expect(remapEdgeIndex(3, split)).toEqual({ index: 4, same: true });
  });

  it("after a removed vertex: the two edges at it merge, later edges move down", () => {
    // Square, remove vertex 2: edges 1 and 2 become edge 1, edge 3 becomes edge 2.
    const remove = { kind: "remove", vertex: 2, count: 4 } as const;
    expect(remapEdgeIndex(0, remove)).toEqual({ index: 0, same: true });
    expect(remapEdgeIndex(1, remove)).toEqual({ index: 1, same: false });
    expect(remapEdgeIndex(2, remove)).toEqual({ index: 1, same: false });
    expect(remapEdgeIndex(3, remove)).toEqual({ index: 2, same: true });
  });

  it("after removing vertex 0: the last edge and edge 0 become the new last edge", () => {
    const remove = { kind: "remove", vertex: 0, count: 4 } as const;
    expect(remapEdgeIndex(0, remove)).toEqual({ index: 2, same: false });
    expect(remapEdgeIndex(3, remove)).toEqual({ index: 2, same: false });
    expect(remapEdgeIndex(1, remove)).toEqual({ index: 0, same: true });
    expect(remapEdgeIndex(2, remove)).toEqual({ index: 1, same: true });
  });
});

describe("energy with shared walls", () => {
  it("a party wall loses no heat and its area is reported apart", () => {
    let n = 0;
    const house = buildingFromBox(
      {
        name: "Terrace",
        width: 10,
        depth: 8,
        storeys: 2,
        storeyHeight: 3,
        roof: "flat",
        era: "pre1918",
        centre: { x: 0, y: 0 },
      },
      "de",
      (prefix) => `${prefix}-${n++}`,
    );
    const free = computeEnergy(house);
    const terraced = computeEnergy({ ...house, sharedEdges: [1, 3] });
    // Two 8 m side walls, two storeys of 3 m.
    expect(terraced.sharedWallArea).toBeCloseTo(2 * 8 * 3 * 2, 6);
    expect(free.sharedWallArea).toBe(0);
    const wallU = house.constructions.find((c) => c.id === house.wallConstructionId)!.uValue;
    expect(free.transmissionLoss - terraced.transmissionLoss).toBeGreaterThanOrEqual(
      wallU * 96 - 1e-6,
    );
    expect(terraced.specificHeatingDemand).toBeLessThan(free.specificHeatingDemand);
  });
});

describe("whole-building heat load", () => {
  it("is the loss coefficients times 34 K", () => {
    expect(buildingHeatLoad({ transmissionLoss: 1000, ventilationLoss: 500 })).toBe(1500 * 34);
  });
});
