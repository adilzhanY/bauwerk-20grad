import { describe, expect, it } from "vitest";
import { area } from "./polygon";
import { exampleHouse } from "@/lib/examples";
import { buildingCentre, translateBuilding } from "./transform";

describe("translateBuilding", () => {
  it("moves every plan coordinate and nothing else", () => {
    const b = exampleHouse("en");
    b.heatPumps = [{ id: "hp", position: { x: -2, y: 1 }, power: 8, kind: "air" }];
    b.storeys[0]!.pipes = [
      {
        id: "pipe",
        points: [
          { x: 1, y: 1 },
          { x: 3, y: 1 },
        ],
      },
    ];
    const moved = translateBuilding(b, { x: 3, y: -1.5 });
    expect(buildingCentre(moved)).toEqual({ x: 8, y: 2.5 });
    expect(area(moved.footprint)).toBeCloseTo(area(b.footprint));
    expect(moved.storeys[0]?.interiorWalls[0]?.a).toEqual({ x: 7, y: -1.5 });
    expect(moved.storeys[0]?.rooms.map((r) => r.id)).toEqual(b.storeys[0]?.rooms.map((r) => r.id));
    expect(moved.storeys[0]?.rooms[0]?.area).toBeCloseTo(b.storeys[0]?.rooms[0]?.area ?? 0);
    expect(moved.heatPumps?.[0]?.position).toEqual({ x: 1, y: -0.5 });
    expect(moved.storeys[0]?.pipes?.[0]?.points).toEqual([
      { x: 4, y: -0.5 },
      { x: 6, y: -0.5 },
    ]);
    // Openings and radiators are offsets, so they are the same objects' values.
    expect(moved.storeys[0]?.openings).toEqual(b.storeys[0]?.openings);
    expect(moved.origin).toBe(b.origin);
    expect(translateBuilding(b, { x: 0, y: 0 })).toBe(b);
  });
});
