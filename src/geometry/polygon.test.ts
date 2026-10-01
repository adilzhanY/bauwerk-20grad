import { describe, expect, it } from "vitest";
import {
  area,
  bounds,
  centroid,
  edges,
  ensureCounterClockwise,
  interiorPoint,
  isCounterClockwise,
  isSimplePolygon,
  lineIntersection,
  overlapOnEdge,
  pointInPolygon,
  segmentsIntersect,
  signedArea,
  snapPoint,
  spansOnEdge,
} from "./polygon";
import type { Vec2 } from "./types";

import { lShape, rect } from "./fixtures";

const bowtie: Vec2[] = [
  { x: 0, y: 0 },
  { x: 4, y: 4 },
  { x: 4, y: 0 },
  { x: 0, y: 4 },
];

describe("signedArea and orientation", () => {
  it("is positive for a counter-clockwise rectangle", () => {
    expect(signedArea(rect)).toBe(80);
    expect(isCounterClockwise(rect)).toBe(true);
  });

  it("is negative when reversed and ensureCounterClockwise fixes it", () => {
    const cw = [...rect].reverse();
    expect(signedArea(cw)).toBe(-80);
    expect(isCounterClockwise(cw)).toBe(false);
    const fixed = ensureCounterClockwise(cw);
    expect(isCounterClockwise(fixed)).toBe(true);
    expect(area(fixed)).toBe(80);
    expect(ensureCounterClockwise(rect)).toEqual(rect);
  });

  it("computes the L shape area", () => {
    expect(area(lShape)).toBe(80 - 12);
  });
});

describe("isSimplePolygon", () => {
  it("accepts the rectangle and the L shape", () => {
    expect(isSimplePolygon(rect)).toBe(true);
    expect(isSimplePolygon(lShape)).toBe(true);
  });

  it("rejects a self-intersecting bowtie", () => {
    expect(isSimplePolygon(bowtie)).toBe(false);
  });

  it("rejects fewer than 3 vertices, repeated vertices and zero area", () => {
    expect(isSimplePolygon([])).toBe(false);
    expect(isSimplePolygon(rect.slice(0, 2))).toBe(false);
    expect(isSimplePolygon([...rect, { x: 0, y: 0 }])).toBe(false);
    expect(
      isSimplePolygon([
        { x: 0, y: 0 },
        { x: 5, y: 0 },
        { x: 10, y: 0 },
      ]),
    ).toBe(false);
  });

  it("rejects a vertex dragged onto a non-adjacent edge", () => {
    const touching: Vec2[] = [
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 10, y: 8 },
      { x: 5, y: 0 },
    ];
    expect(isSimplePolygon(touching)).toBe(false);
  });
});

describe("segmentsIntersect and lineIntersection", () => {
  it("detects crossing, touching and disjoint segments", () => {
    expect(segmentsIntersect({ x: 0, y: 0 }, { x: 4, y: 4 }, { x: 0, y: 4 }, { x: 4, y: 0 })).toBe(
      true,
    );
    expect(segmentsIntersect({ x: 0, y: 0 }, { x: 4, y: 0 }, { x: 4, y: 0 }, { x: 4, y: 4 })).toBe(
      true,
    );
    expect(segmentsIntersect({ x: 0, y: 0 }, { x: 4, y: 0 }, { x: 0, y: 1 }, { x: 4, y: 1 })).toBe(
      false,
    );
    expect(segmentsIntersect({ x: 0, y: 0 }, { x: 4, y: 0 }, { x: 5, y: 0 }, { x: 8, y: 0 })).toBe(
      false,
    );
  });

  it("intersects lines and returns null for parallel lines", () => {
    expect(
      lineIntersection({ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 3, y: -1 }, { x: 3, y: 1 }),
    ).toEqual({
      x: 3,
      y: 0,
    });
    expect(
      lineIntersection({ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 0, y: 1 }, { x: 1, y: 1 }),
    ).toBeNull();
  });
});

describe("pointInPolygon", () => {
  it("handles inside, outside, boundary and the concave notch", () => {
    expect(pointInPolygon({ x: 5, y: 4 }, rect)).toBe(true);
    expect(pointInPolygon({ x: 11, y: 4 }, rect)).toBe(false);
    expect(pointInPolygon({ x: 10, y: 4 }, rect)).toBe(true);
    expect(pointInPolygon({ x: 0, y: 0 }, rect)).toBe(true);
    expect(pointInPolygon({ x: 8, y: 7 }, lShape)).toBe(false);
    expect(pointInPolygon({ x: 3, y: 7 }, lShape)).toBe(true);
    expect(pointInPolygon({ x: 8, y: 2 }, lShape)).toBe(true);
  });
});

describe("edges", () => {
  it("has one edge per vertex with lengths and outward normals", () => {
    const e = edges(rect);
    expect(e).toHaveLength(4);
    expect(e.map((x) => x.length)).toEqual([10, 8, 10, 8]);
    expect(e[0]?.normal).toEqual({ x: 0, y: -1 });
    expect(e[1]?.normal).toEqual({ x: 1, y: 0 });
    expect(e[2]?.normal).toEqual({ x: 0, y: 1 });
    expect(e[3]?.normal).toEqual({ x: -1, y: 0 });
  });

  it("points normals outward on the concave L shape", () => {
    const e = edges(lShape);
    expect(e).toHaveLength(6);
    // Edge 2 runs from (10,5) to (6,5), the top of the lower right block; outward is +y.
    expect(e[2]?.normal).toEqual({ x: 0, y: 1 });
    // Edge 3 runs from (6,5) to (6,8), the inner vertical side; outward is +x.
    expect(e[3]?.normal).toEqual({ x: 1, y: 0 });
  });
});

describe("centroid, bounds, snapping", () => {
  it("finds the rectangle centre and bounds", () => {
    expect(centroid(rect)).toEqual({ x: 5, y: 4 });
    expect(bounds(lShape)).toEqual({ min: { x: 0, y: 0 }, max: { x: 10, y: 8 } });
  });

  it("snaps to the grid", () => {
    expect(snapPoint({ x: 1.24, y: 3.76 }, 0.5)).toEqual({ x: 1, y: 4 });
    expect(snapPoint({ x: 1.26, y: -0.3 }, 0.5)).toEqual({ x: 1.5, y: -0.5 });
  });

  it("falls back to the average of the points for a polygon without area", () => {
    const line = [
      { x: 0, y: 0 },
      { x: 2, y: 0 },
      { x: 4, y: 0 },
    ];
    expect(centroid(line)).toEqual({ x: 2, y: 0 });
    expect(centroid([])).toEqual({ x: 0, y: 0 });
  });
});

describe("edge cases", () => {
  it("counts a point exactly on a vertex as inside", () => {
    for (const p of lShape) expect(pointInPolygon(p, lShape)).toBe(true);
  });

  it("rejects a polygon whose edge folds back on the one before it", () => {
    const spike = [
      { x: 0, y: 0 },
      { x: 4, y: 0 },
      { x: 4, y: 4 },
      { x: 4, y: 2 },
      { x: 0, y: 4 },
    ];
    expect(isSimplePolygon(spike)).toBe(false);
  });

  it("intersects nearly parallel lines far away and gives up only when exactly parallel", () => {
    const p = lineIntersection({ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 0, y: 1 }, { x: 10, y: 1.0001 });
    expect(p!.x).toBeCloseTo(-1e5, 3);
    expect(p!.y).toBeCloseTo(0, 9);
    expect(lineIntersection({ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 0, y: 1 }, { x: 1, y: 1 })).toBe(
      null,
    );
  });
});

describe("interiorPoint", () => {
  it("is the centroid of a convex polygon", () => {
    expect(interiorPoint(rect)).toEqual({ x: 5, y: 4 });
  });

  it("lies inside an L whose centroid is outside it", () => {
    const corridor = [
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 10, y: 2 },
      { x: 2, y: 2 },
      { x: 2, y: 10 },
      { x: 0, y: 10 },
    ];
    expect(pointInPolygon(centroid(corridor), corridor)).toBe(false);
    const p = interiorPoint(corridor);
    expect(pointInPolygon(p, corridor)).toBe(true);
    expect(p.x).toBeGreaterThan(0);
    expect(p.x).toBeLessThan(2);
  });
});

describe("overlapOnEdge and spansOnEdge", () => {
  const bottom = edges(rect)[0]!;

  it("clamps a collinear segment to the edge, whatever its ends", () => {
    expect(overlapOnEdge({ x: -2, y: 0 }, { x: 4, y: 0 }, bottom)).toEqual([0, 4]);
    expect(overlapOnEdge({ x: 12, y: 0 }, { x: 6, y: 0 }, bottom)).toEqual([6, 10]);
    expect(overlapOnEdge({ x: 11, y: 0 }, { x: 12, y: 0 }, bottom)).toBe(null);
    expect(overlapOnEdge({ x: 0, y: 0.1 }, { x: 10, y: 0.1 }, bottom)).toBe(null);
    expect(overlapOnEdge({ x: 0, y: 0 }, { x: 10, y: 1 }, bottom)).toBe(null);
  });

  it("finds a room edge running past a vertex in the middle of a wall", () => {
    const half = edges([{ x: 0, y: 0 }, { x: 5, y: 0 }, ...rect.slice(1)]);
    expect(spansOnEdge(rect, half[0]!)).toEqual([[0, 5]]);
    expect(spansOnEdge(rect, half[1]!)).toEqual([[0, 5]]);
  });
});
