/**
 * Openings measured on a facade photo, put onto one wall of the building.
 *
 * The photo editor measures openings in wall metres, from the bottom left of the wall as
 * seen from outside. A counter-clockwise footprint edge runs left to right as seen from
 * outside, so a photo x is an offset along the edge. The placement rules (which storey, a
 * door close to the floor stands on it, trimming at slabs and wall ends, overlapping finds
 * resolved by confidence) are the same code the LoD2 hand-over uses, `placeOpenings` in
 * lod2-core: the wall is handed over as a plane standing exactly on its footprint edge.
 *
 * Openings already on the wall keep their id and construction when a measured one lands on
 * them, so applying a photo twice changes nothing and the change stays small.
 */
import { placeOpenings } from "lod2-core/survey";
import type { MeasuredOpening, PlacedOpening } from "lod2-core/survey";
import type { WallPlane } from "lod2-core/wall";
import { createId } from "@/lib/ids";
import type { Building, Opening, ValueSource } from "./types";

/** The wall on footprint edge `edge`, as the photo editor sees it: edge length by eaves height. */
export function wallPlaneFor(building: Building, edge: number): WallPlane | null {
  const a = building.footprint[edge];
  const b = building.footprint[(edge + 1) % building.footprint.length];
  if (!a || !b) return null;
  const width = Math.hypot(b.x - a.x, b.y - a.y);
  const height = building.storeys.reduce((sum, s) => sum + s.height, 0);
  if (width < 1e-6 || height <= 0) return null;
  const dir = { x: (b.x - a.x) / width, y: (b.y - a.y) / width };
  // Outward for a counter-clockwise footprint: to the right of the edge's direction.
  const normal = { x: dir.y, y: -dir.x };
  const bearing = building.origin?.rotation ?? 0;
  const azimuth =
    (((bearing + (Math.atan2(normal.x, normal.y) * 180) / Math.PI) % 360) + 360) % 360;
  return {
    // ponytail: a rectangle up to the eaves; a gable above is not part of the photo's wall.
    points: [
      { x: 0, y: 0 },
      { x: width, y: 0 },
      { x: width, y: height },
      { x: 0, y: height },
    ],
    width,
    height,
    origin: [a.x, a.y, 0],
    u: [dir.x, dir.y, 0],
    v: [0, 0, 1],
    normal: [normal.x, normal.y, 0],
    azimuth,
  };
}

export type ChangeKind = "added" | "moved" | "kept" | "removed";

/** One opening of the wall before or after, and what applying the photo does to it. */
export interface WallChange {
  change: ChangeKind;
  storeyId: string;
  opening: Opening;
  /** Detection confidence 0 to 1, for photo openings found automatically. */
  score?: number;
  /** Why it differs from what was measured, in the words of the placement (German). */
  notes: string[];
}

export interface WallPlan {
  /** The building with the wall's openings replaced. */
  building: Building;
  changes: WallChange[];
  /** Measured openings that could not be placed, by index, with the reason. */
  dropped: { index: number; reason: string }[];
}

/** Overlap of two ranges, metres. */
const overlap = (a0: number, a1: number, b0: number, b1: number) =>
  Math.max(0, Math.min(a1, b1) - Math.max(a0, b0));

/** Measured and existing openings count as one when they share this much of their width. */
const SAME_OPENING_SHARE = 0.5;
/** Changes smaller than this, metres, leave an opening as it was. */
const SAME_POSITION_M = 0.01;

/**
 * What the wall on `edge` looks like with the measured openings, storey by storey, and the
 * building with exactly that change. `source` describes the photo for each placed opening.
 */
export function planWallOpenings(
  building: Building,
  edge: number,
  measured: readonly MeasuredOpening[],
  source: (placed: PlacedOpening) => ValueSource,
): WallPlan | null {
  const plane = wallPlaneFor(building, edge);
  if (!plane) return null;
  const heights = building.storeys.map((s) => s.height);
  const frame = { center: { x: 0, y: 0 }, angle: 0, bearing: building.origin?.rotation ?? 0 };
  const result = placeOpenings(measured, plane, frame, building.footprint, heights);
  const dropped = result.dropped.map((d) => ({
    index: measured.indexOf(d.opening),
    reason: d.reason,
  }));
  // The plane stands on this edge, so every placed opening is on it; anything else is a bug.
  if (result.edge !== null && result.edge !== edge) return null;

  const changes: WallChange[] = [];
  const sources: Record<string, ValueSource> = { ...building.sources };
  const storeys = building.storeys.map((storey, index) => {
    const onWall = (o: Opening) => !o.interior && o.wallIndex === edge;
    const before = storey.openings.filter(onWall);
    const unused = new Set(before);
    const placed = result.placed.filter((p) => p.storey === index);
    const next: Opening[] = placed.map((p) => {
      // The existing opening this one lands on, if any: most shared width, same kind of span.
      let match: Opening | null = null;
      let best = 0;
      for (const old of unused) {
        const shared = overlap(p.offset, p.offset + p.width, old.offset, old.offset + old.width);
        const vertical = overlap(p.sill, p.sill + p.height, old.sill, old.sill + old.height);
        if (
          vertical > 0 &&
          shared > best &&
          shared >= SAME_OPENING_SHARE * Math.min(p.width, old.width)
        ) {
          best = shared;
          match = old;
        }
      }
      if (match) unused.delete(match);
      const opening: Opening = {
        id: match?.id ?? createId("opening"),
        wallIndex: edge,
        kind: p.kind,
        offset: p.offset,
        width: p.width,
        height: p.height,
        sill: p.sill,
        constructionId:
          match?.kind === p.kind
            ? match.constructionId
            : p.kind === "door"
              ? building.doorConstructionId
              : building.windowConstructionId,
      };
      const found: Opening | null = match;
      const same =
        found !== null &&
        found.kind === opening.kind &&
        (["offset", "width", "height", "sill"] as const).every(
          (key) => Math.abs(found[key] - opening[key]) < SAME_POSITION_M,
        );
      changes.push({
        change: !match ? "added" : same ? "kept" : "moved",
        storeyId: storey.id,
        opening,
        ...(p.score === undefined ? {} : { score: p.score }),
        notes: p.notes,
      });
      sources[`opening:${opening.id}`] = {
        ...source(p),
        value: [edge, opening.kind, opening.offset, opening.width, opening.height, opening.sill],
      };
      return opening;
    });
    for (const old of unused) {
      changes.push({ change: "removed", storeyId: storey.id, opening: old, notes: [] });
      // eslint-disable-next-line @typescript-eslint/no-dynamic-delete -- sources are keyed by opening id
      delete sources[`opening:${old.id}`];
    }
    // Openings stay where they were in the list, so nothing else on the storey moves.
    const byId = new Map(next.map((o) => [o.id, o]));
    const openings = storey.openings.flatMap((o) => {
      if (!onWall(o)) return [o];
      const replaced = byId.get(o.id);
      return replaced ? [replaced] : [];
    });
    const kept = new Set(openings.map((o) => o.id));
    return { ...storey, openings: [...openings, ...next.filter((o) => !kept.has(o.id))] };
  });
  const noSources = building.sources === undefined && Object.keys(sources).length === 0;
  return {
    building: noSources ? { ...building, storeys } : { ...building, storeys, sources },
    changes,
    dropped,
  };
}
