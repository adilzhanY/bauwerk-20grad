import { describe, expect, it } from "vitest";
import { lShape, rect } from "./fixtures";
import { area, pointInPolygon } from "./polygon";
import {
  cleanRing,
  clipSegmentToPolygon,
  computeRooms,
  extractFaces,
  splitSegments,
} from "./rooms";
import type { Room, Segment } from "./types";

let n = 0;
const factory = { createId: () => `room_${++n}`, defaultName: (i: number) => `Room ${i}` };

const totalArea = (rooms: readonly { area: number }[]) => rooms.reduce((s, r) => s + r.area, 0);

describe("extractFaces", () => {
  it("no interior walls gives one room equal to the footprint", () => {
    const faces = extractFaces(rect, []);
    expect(faces).toHaveLength(1);
    expect(area(faces[0] ?? [])).toBe(80);
  });

  it("one wall across a rectangle gives two rooms whose areas sum to the footprint", () => {
    const wall: Segment = { a: { x: 4, y: 0 }, b: { x: 4, y: 8 } };
    const faces = extractFaces(rect, [wall]);
    expect(faces).toHaveLength(2);
    expect(faces.map((f) => area(f)).sort((a, b) => a - b)).toEqual([32, 48]);
  });

  it("a dangling wall that does not split anything still gives one room", () => {
    const wall: Segment = { a: { x: 4, y: 0 }, b: { x: 4, y: 5 } };
    const faces = extractFaces(rect, [wall]);
    expect(faces).toHaveLength(1);
    expect(area(faces[0] ?? [])).toBe(80);
    expect(faces[0]).toHaveLength(4);
  });

  it("a wall floating inside the room gives one room", () => {
    const wall: Segment = { a: { x: 3, y: 3 }, b: { x: 6, y: 3 } };
    const faces = extractFaces(rect, [wall]);
    expect(faces).toHaveLength(1);
    expect(area(faces[0] ?? [])).toBe(80);
  });

  it("two crossing walls give four rooms", () => {
    const faces = extractFaces(rect, [
      { a: { x: 4, y: 0 }, b: { x: 4, y: 8 } },
      { a: { x: 0, y: 3 }, b: { x: 10, y: 3 } },
    ]);
    expect(faces).toHaveLength(4);
    expect(totalArea(faces.map((f) => ({ area: area(f) })))).toBeCloseTo(80, 6);
    expect(faces.map((f) => area(f)).sort((a, b) => a - b)).toEqual(
      [12, 20, 18, 30].sort((a, b) => a - b),
    );
  });

  it("a wall poking outside the footprint is clipped and still splits", () => {
    const wall: Segment = { a: { x: 4, y: -2 }, b: { x: 4, y: 12 } };
    const faces = extractFaces(rect, [wall]);
    expect(faces).toHaveLength(2);
    expect(totalArea(faces.map((f) => ({ area: area(f) })))).toBeCloseTo(80, 6);
  });

  it("splits the concave L shape", () => {
    const wall: Segment = { a: { x: 6, y: 0 }, b: { x: 6, y: 5 } };
    const faces = extractFaces(lShape, [wall]);
    expect(faces).toHaveLength(2);
    expect(faces.map((f) => area(f)).sort((a, b) => a - b)).toEqual([20, 48]);
    for (const f of faces) for (const p of f) expect(pointInPolygon(p, lShape)).toBe(true);
  });

  it("a wall fully outside the footprint is ignored", () => {
    expect(clipSegmentToPolygon({ a: { x: 20, y: 0 }, b: { x: 20, y: 8 } }, rect)).toEqual([]);
    expect(extractFaces(rect, [{ a: { x: 20, y: 0 }, b: { x: 20, y: 8 } }])).toHaveLength(1);
  });
});

describe("helpers", () => {
  it("splitSegments cuts at crossings and drops duplicates", () => {
    const pieces = splitSegments([
      { a: { x: 0, y: 0 }, b: { x: 4, y: 0 } },
      { a: { x: 2, y: -1 }, b: { x: 2, y: 1 } },
      { a: { x: 0, y: 0 }, b: { x: 4, y: 0 } },
    ]);
    expect(pieces).toHaveLength(4);
  });

  it("cleanRing removes spikes and collinear points", () => {
    const ring = [
      { x: 0, y: 0 },
      { x: 5, y: 0 },
      { x: 10, y: 0 },
      { x: 10, y: 8 },
      { x: 4, y: 8 },
      { x: 4, y: 5 },
      { x: 4, y: 8 },
      { x: 0, y: 8 },
    ];
    expect(cleanRing(ring)).toEqual(rect);
  });
});

describe("computeRooms", () => {
  it("names new rooms and keeps names and zones through a split", () => {
    n = 0;
    const first = computeRooms(rect, [], [], factory);
    expect(first).toEqual([{ id: "room_1", name: "Room 1", polygon: rect, area: 80 }]);

    const named: Room[] = [{ ...first[0]!, name: "Kitchen", zoneId: "zone_a" }];
    const split = computeRooms(rect, [{ a: { x: 4, y: 0 }, b: { x: 4, y: 8 } }], named, factory);
    expect(split).toHaveLength(2);
    const kitchen = split.find((r) => r.name === "Kitchen");
    const other = split.find((r) => r.name !== "Kitchen");
    expect(kitchen?.id).toBe("room_1");
    expect(kitchen?.zoneId).toBe("zone_a");
    // The old centroid (5,4) lies in the right hand part, which is 6 by 8.
    expect(kitchen?.area).toBe(48);
    expect(other?.name).toBe("Room 1");
    expect(other?.zoneId).toBeUndefined();
    expect(totalArea(split)).toBeCloseTo(80, 6);
  });

  it("removing a wall merges rooms and keeps the larger room's identity", () => {
    n = 0;
    const wall: Segment = { a: { x: 4, y: 0 }, b: { x: 4, y: 8 } };
    const two = computeRooms(rect, [wall], [], factory);
    const big = two.find((r) => r.area === 48);
    const merged = computeRooms(rect, [], two, factory);
    expect(merged).toHaveLength(1);
    expect(merged[0]?.id).toBe(big?.id);
  });

  it("room areas sum to the footprint area within 1 square centimetre", () => {
    const walls: Segment[] = [
      { a: { x: 3.5, y: 0 }, b: { x: 3.5, y: 8 } },
      { a: { x: 0, y: 4.5 }, b: { x: 10, y: 4.5 } },
      { a: { x: 7, y: 4.5 }, b: { x: 7, y: 8 } },
    ];
    const rooms = computeRooms(rect, walls, [], factory);
    expect(rooms).toHaveLength(5);
    expect(Math.abs(totalArea(rooms) - 80)).toBeLessThan(1e-4);
    for (const r of rooms) for (const p of r.polygon) expect(pointInPolygon(p, rect)).toBe(true);
  });
});

describe("computeRooms with a concave room", () => {
  // A 10 x 10 footprint with an L-shaped corridor (36 m²) wrapped around a 64 m² room. The
  // corridor's centroid (3.22, 3.22) lies inside the big room, not inside the corridor.
  const square = [
    { x: 0, y: 0 },
    { x: 10, y: 0 },
    { x: 10, y: 10 },
    { x: 0, y: 10 },
  ];
  const walls: Segment[] = [
    { a: { x: 2, y: 2 }, b: { x: 10, y: 2 } },
    { a: { x: 2, y: 2 }, b: { x: 2, y: 10 } },
  ];
  const named = (): Room[] =>
    computeRooms(square, walls, [], factory).map((r) =>
      r.area > 50 ? { ...r, name: "Living" } : { ...r, name: "Corridor", zoneId: "cold" },
    );
  const corridorOf = (rooms: Room[]) => rooms.find((r) => Math.abs(r.area - 36) < 1e-6)!;

  it("keeps the corridor's id, name and zone when recomputed with the same walls", () => {
    const before = named();
    const after = computeRooms(square, walls, before, factory);
    const corridor = corridorOf(after);
    expect(corridor.id).toBe(corridorOf(before).id);
    expect(corridor.name).toBe("Corridor");
    expect(corridor.zoneId).toBe("cold");
    expect(after.find((r) => r.name === "Living")!.zoneId).toBeUndefined();
  });

  it("keeps them when an unrelated wall splits the other room", () => {
    const before = named();
    const after = computeRooms(
      square,
      [...walls, { a: { x: 6, y: 2 }, b: { x: 6, y: 10 } }],
      before,
      factory,
    );
    const corridor = corridorOf(after);
    expect(corridor.id).toBe(corridorOf(before).id);
    expect(corridor.name).toBe("Corridor");
    expect(corridor.zoneId).toBe("cold");
    expect(after.filter((r) => r.zoneId === "cold")).toHaveLength(1);
  });
});
