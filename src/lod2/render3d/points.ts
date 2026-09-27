/**
 * Reading flat coordinate arrays ([x0, y0, z0, x1, y1, z1, ...]) as the LoD2 meshes store
 * them, without a non-null assertion at every index.
 */

export type Triple = [number, number, number];

/** The value at `index`, which the caller's bounds guarantee. Throws on malformed data. */
export function at(values: ArrayLike<number>, index: number): number {
  const value = values[index];
  if (value === undefined) {
    throw new Error(`Coordinate ${String(index)} is outside an array of ${String(values.length)}`);
  }
  return value;
}

/** Every complete [x, y, z] triple of a flat array whose last coordinate lies before `end`. */
export function* triples(values: ArrayLike<number>, end = values.length): Generator<Triple> {
  for (let i = 0; i + 2 < end; i += 3) {
    yield [at(values, i), at(values, i + 1), at(values, i + 2)];
  }
}

/** The corners of every complete triangle of a triangulation, in its own coordinates. */
export function* triangleCorners(tri: {
  positions: ArrayLike<number>;
  indices: ArrayLike<number>;
}): Generator<Triple> {
  for (let t = 0; t + 2 < tri.indices.length; t += 3) {
    for (let c = 0; c < 3; c++) {
      const k = at(tri.indices, t + c);
      yield [at(tri.positions, k * 3), at(tri.positions, k * 3 + 1), at(tri.positions, k * 3 + 2)];
    }
  }
}
