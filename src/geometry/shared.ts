import type { Building } from "./types";

/**
 * Walls against a heated neighbour. In a terrace or a Berlin block most side walls are fire
 * walls shared with the next building, which is heated too, so they lose almost no heat. A
 * building brings them as footprint edge indexes in `sharedEdges`; this file keeps those
 * indexes right when the footprint is edited.
 */

export function sharedEdgeSet(building: Pick<Building, "sharedEdges">): Set<number> {
  return new Set(building.sharedEdges ?? []);
}

/**
 * Edge indexes after edge `edgeIndex` was split in two at a new vertex: later edges move up by
 * one, and a split shared edge stays shared on both halves.
 */
export function sharedAfterSplit(shared: readonly number[], edgeIndex: number): number[] {
  const out: number[] = [];
  for (const e of shared) {
    if (e < edgeIndex) out.push(e);
    else if (e === edgeIndex) out.push(e, e + 1);
    else out.push(e + 1);
  }
  return out;
}

/**
 * Edge indexes after vertex `index` of a footprint with `count` vertices was removed: the two
 * edges that met there become one, shared only when both were, and later edges move down.
 */
export function sharedAfterRemove(
  shared: readonly number[],
  index: number,
  count: number,
): number[] {
  const before = (index - 1 + count) % count;
  const set = new Set(shared);
  const mergedShared = set.has(before) && set.has(index);
  const out: number[] = [];
  for (const e of shared) {
    if (e === before || e === index) continue;
    out.push(e > index ? e - 1 : e);
  }
  if (mergedShared) {
    // The merged edge takes the index of the edge before the removed vertex, shifted like the
    // others when it came after it (only when the removed vertex was vertex 0).
    out.push(before > index ? before - 1 : before);
  }
  return [...new Set(out)].sort((a, b) => a - b);
}

/**
 * Where an item on edge `edgeIndex`, at `offset` metres, lands after that edge was split at
 * `splitAt` metres: on the first half unchanged, on the second half with the offset measured
 * from the new vertex, or nowhere when it spans the split.
 */
export function placeAfterSplit(
  wallIndex: number,
  offset: number,
  width: number,
  edgeIndex: number,
  splitAt: number,
): { wallIndex: number; offset: number } | null {
  if (wallIndex < edgeIndex) return { wallIndex, offset };
  if (wallIndex > edgeIndex) return { wallIndex: wallIndex + 1, offset };
  if (offset + width <= splitAt + 1e-9) return { wallIndex, offset };
  if (offset >= splitAt - 1e-9) return { wallIndex: wallIndex + 1, offset: offset - splitAt };
  return null;
}
