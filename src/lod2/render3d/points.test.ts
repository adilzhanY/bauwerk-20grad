import { describe, expect, it } from "vitest";
import { at, triangleCorners, triples } from "./points";

describe("flat coordinate arrays", () => {
  it("reads complete triples only, up to an end", () => {
    expect([...triples([1, 2, 3, 4, 5, 6, 7])]).toEqual([
      [1, 2, 3],
      [4, 5, 6],
    ]);
    expect([...triples([1, 2, 3, 4, 5, 6], 3)]).toEqual([[1, 2, 3]]);
  });

  it("walks the corners of each triangle", () => {
    const tri = { positions: [0, 0, 0, 1, 0, 0, 0, 1, 0], indices: [2, 0, 1] };
    expect([...triangleCorners(tri)]).toEqual([
      [0, 1, 0],
      [0, 0, 0],
      [1, 0, 0],
    ]);
  });

  it("throws on an index outside the data", () => {
    expect(() => at([1], 3)).toThrow(/outside/);
  });
});
