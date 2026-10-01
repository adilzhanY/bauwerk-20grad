import { describe, expect, it } from "vitest";
import { DEFAULT_ASSIGNMENT, defaultConstructions } from "./constructions";
import { lShape, rect } from "./fixtures";
import { area } from "./polygon";
import { buildRoof, decomposeRectilinear, isRectilinear, offsetPolygon } from "./roof";
import type { Building, Roof } from "./types";

const b = (roof: Partial<Roof>, footprint = rect): Building => ({
  id: "b",
  name: "b",
  footprint,
  wallThickness: 0.3,
  storeys: [],
  zones: [],
  constructions: defaultConstructions("en"),
  ...DEFAULT_ASSIGNMENT,
  roof,
});

const deg = (d: number) => (d * Math.PI) / 180;

describe("offsetPolygon", () => {
  it("grows a rectangle by the overhang on every side", () => {
    const o = offsetPolygon(rect, 0.5);
    expect(area(o)).toBeCloseTo(11 * 9);
    expect(o[0]?.x).toBeCloseTo(-0.5);
    expect(o[0]?.y).toBeCloseTo(-0.5);
  });
});

describe("gable roof", () => {
  it("on the 10 by 8 rectangle at 40 degrees, ridge along x, no overhang", () => {
    const r = buildRoof(b({ kind: "gable", pitch: 40, overhang: 0, ridgeAxis: "x" }), 3);
    expect(r.builtKind).toBe("gable");
    expect(r.faces).toHaveLength(2);
    expect(r.faces[0]!.area).toBeCloseTo(r.faces[1]!.area);
    expect(r.area).toBeCloseTo(80 / Math.cos(deg(40)));
    expect(r.ridgeHeight).toBeCloseTo(4 * Math.tan(deg(40)));
    expect(r.ridge?.a.z).toBeCloseTo(3 + 4 * Math.tan(deg(40)));
    // Eave points sit at the storey top.
    const eaveZ = r.faces
      .flatMap((f) => f.points)
      .filter((p) => Math.abs(p.y) < 1e-9 || Math.abs(p.y - 8) < 1e-9);
    expect(eaveZ.every((p) => Math.abs(p.z - 3) < 1e-9)).toBe(true);
    // Attic volume of a triangular prism: 0.5 x span x ridge height x length.
    expect(r.atticVolume).toBeCloseTo(0.5 * 8 * 4 * Math.tan(deg(40)) * 10);
  });

  it("overhang adds eave strips and area follows the enlarged plan", () => {
    const r = buildRoof(b({ kind: "gable", pitch: 30, overhang: 0.5, ridgeAxis: "x" }), 3);
    expect(area(r.eaves)).toBeCloseTo(99);
    expect(r.area).toBeCloseTo(99 / Math.cos(deg(30)));
  });

  it("ridge axis y swaps the span", () => {
    const r = buildRoof(b({ kind: "gable", pitch: 45, overhang: 0, ridgeAxis: "y" }), 0);
    expect(r.ridgeHeight).toBeCloseTo(5);
    expect(r.ridge?.a.x).toBeCloseTo(5);
    expect(r.ridge?.a.y).toBeCloseTo(0);
    expect(r.ridge?.b.y).toBeCloseTo(8);
  });

  it("becomes a cross gable on the L shape: one gable per wing, eaves on every wall", () => {
    const r = buildRoof(b({ kind: "gable", pitch: 30, overhang: 0, ridgeAxis: "x" }, lShape), 3);
    // L: 10 by 5 lower block and 6 by 3 upper block along x.
    expect(r.faces).toHaveLength(4);
    expect(r.ridges).toHaveLength(2);
    expect(r.faces.reduce((s, f) => s + f.planArea, 0)).toBeCloseTo(area(lShape));
    expect(r.area).toBeCloseTo(area(lShape) / Math.cos(deg(30)));
    // Every outer eave point sits on the storey top; no wing floats above its wall.
    const eavePoints = r.faces
      .flatMap((f) => f.points)
      .filter((p) => Math.abs(p.y) < 1e-9 || Math.abs(p.y - 8) < 1e-9 || Math.abs(p.y - 5) < 1e-9);
    expect(eavePoints.length).toBeGreaterThan(0);
    expect(eavePoints.every((p) => Math.abs(p.z - 3) < 1e-9)).toBe(true);
    expect(r.ridgeHeight).toBeCloseTo(2.5 * Math.tan(deg(30)));
    expect(r.atticVolume).toBeCloseTo(
      0.5 * 5 * 2.5 * Math.tan(deg(30)) * 10 + 0.5 * 3 * 1.5 * Math.tan(deg(30)) * 6,
    );
  });

  it("decomposes rectilinear polygons into maximal strips along the axis", () => {
    expect(decomposeRectilinear(rect, "x")).toEqual([
      { min: { x: 0, y: 0 }, max: { x: 10, y: 8 } },
    ]);
    const l = decomposeRectilinear(lShape, "x");
    expect(l).toHaveLength(2);
    expect(
      l.map((r) => (r.max.x - r.min.x) * (r.max.y - r.min.y)).reduce((s, v) => s + v, 0),
    ).toBeCloseTo(68);
    expect(decomposeRectilinear(lShape, "y")).toHaveLength(2);
    expect(isRectilinear(lShape)).toBe(true);
    expect(
      isRectilinear([
        { x: 0, y: 0 },
        { x: 4, y: 1 },
        { x: 0, y: 3 },
      ]),
    ).toBe(false);
  });
});

describe("hip roof", () => {
  it("on a square equals the gable area and has four faces", () => {
    const square = [
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 10, y: 10 },
      { x: 0, y: 10 },
    ];
    const hip = buildRoof(b({ kind: "hip", pitch: 35, overhang: 0, ridgeAxis: "x" }, square), 0);
    const gable = buildRoof(
      b({ kind: "gable", pitch: 35, overhang: 0, ridgeAxis: "x" }, square),
      0,
    );
    expect(hip.builtKind).toBe("hip");
    expect(hip.faces).toHaveLength(4);
    expect(hip.area).toBeCloseTo(gable.area, 5);
    expect(hip.ridge?.a.x).toBeCloseTo(5); // a pyramid: ridge collapses to a point
    expect(hip.atticVolume).toBeCloseTo((100 * 5 * Math.tan(deg(35))) / 3); // pyramid volume
  });

  it("on the 10 by 8 rectangle has a ridge of 2 m and falls back to gable on the L shape", () => {
    const hip = buildRoof(b({ kind: "hip", pitch: 30, overhang: 0, ridgeAxis: "x" }), 3);
    expect(hip.ridge!.b.x - hip.ridge!.a.x).toBeCloseTo(2);
    expect(hip.area).toBeCloseTo(80 / Math.cos(deg(30)), 5);
    const fallback = buildRoof(
      b({ kind: "hip", pitch: 30, overhang: 0, ridgeAxis: "x" }, lShape),
      3,
    );
    expect(fallback.builtKind).toBe("gable");
  });

  it("runs the hip ridge along the longer side regardless of the gable axis setting", () => {
    const hip = buildRoof(b({ kind: "hip", pitch: 30, overhang: 0, ridgeAxis: "y" }), 0);
    expect(hip.ridge?.a.y).toBeCloseTo(4);
    expect(hip.ridge?.b.y).toBeCloseTo(4);
    expect(hip.ridge!.b.x - hip.ridge!.a.x).toBeCloseTo(2);
    expect(hip.ridgeHeight).toBeCloseTo(4 * Math.tan(deg(30)));
  });
});

describe("flat roof", () => {
  it("area equals the footprint and there is no attic", () => {
    const r = buildRoof(b({ kind: "flat" }), 6);
    expect(r.area).toBe(80);
    expect(r.faces[0]?.points[0]?.z).toBe(6);
    expect(r.atticVolume).toBe(0);
    expect(r.ridge).toBeNull();
  });
});

describe("a footprint with a vertex in the middle of a straight wall", () => {
  const withMid = [
    { x: 0, y: 0 },
    { x: 5, y: 0 },
    ...rect.slice(1, 2),
    { x: 10, y: 4 },
    ...rect.slice(2),
  ];

  for (const kind of ["hip", "gable"] as const) {
    it(`builds the same ${kind} roof as the plain rectangle`, () => {
      const roof = { kind, pitch: 40, overhang: 0.5, ridgeAxis: "x" } as const;
      const plain = buildRoof(b(roof), 3);
      const split = buildRoof(b(roof, withMid), 3);
      expect(split.builtKind).toBe(kind);
      expect(split.area).toBeCloseTo(plain.area);
      expect(split.atticVolume).toBeCloseTo(plain.atticVolume);
      expect(split.ridgeHeight).toBeCloseTo(plain.ridgeHeight);
    });
  }
});
