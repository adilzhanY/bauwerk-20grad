import type { Building, ValueSource } from "./types";

/**
 * Where a building's values came from, when it was brought in from a survey (for example the
 * lod2 viewer: LoD2 city model, facade photos, the official default U-values). Each source is
 * stored with the value it was given; comparing that with the building as it is now tells an
 * untouched value from one the consultant has edited, without any bookkeeping in the editor's
 * actions.
 *
 * Canonical values, the contract with the writer of the file:
 *
 *   footprint      x0, y0, x1, y1, ... in metres
 *   storeys        the storey heights, ground floor first
 *   roof           kind, pitch, ridge axis
 *   constructions  U of the assigned wall, roof, floor, window and door construction
 *   sharedEdges    the shared edge indexes
 *   opening:<id>   wall index, kind, offset, width, height, sill
 */

export type SourcePath = string;

export function sourceValue(building: Building, path: SourcePath): (number | string)[] | null {
  if (path === "footprint") return building.footprint.flatMap((p) => [p.x, p.y]);
  if (path === "storeys") return building.storeys.map((s) => s.height);
  if (path === "roof") {
    const roof = building.roof ?? {};
    return [roof.kind ?? "flat", roof.pitch ?? 0, roof.ridgeAxis ?? "x"];
  }
  if (path === "sharedEdges") return [...(building.sharedEdges ?? [])];
  if (path === "constructions") {
    const u = (id: string) => building.constructions.find((c) => c.id === id)?.uValue ?? 0;
    return [
      building.wallConstructionId,
      building.roofConstructionId,
      building.floorConstructionId,
      building.windowConstructionId,
      building.doorConstructionId,
    ].map(u);
  }
  if (path.startsWith("opening:")) {
    const id = path.slice("opening:".length);
    const opening = building.storeys.flatMap((s) => s.openings).find((o) => o.id === id);
    return opening
      ? [
          opening.wallIndex,
          opening.kind,
          opening.offset,
          opening.width,
          opening.height,
          opening.sill,
        ]
      : null;
  }
  return null;
}

/** Numbers equal to a tenth of a millimetre count as unchanged, so rounding is not an edit. */
function sameValue(a: readonly (number | string)[], b: readonly (number | string)[]): boolean {
  if (a.length !== b.length) return false;
  return a.every((v, i) => {
    const w = b[i];
    return typeof v === "number" && typeof w === "number" ? Math.abs(v - w) < 1e-4 : v === w;
  });
}

export interface SourceStatus {
  source: ValueSource;
  /** The value has changed since it was brought in. */
  edited: boolean;
  /** The value no longer exists, for example a deleted opening. */
  gone: boolean;
}

export function sourceStatus(building: Building, path: SourcePath): SourceStatus | null {
  const source = building.sources?.[path];
  if (!source) return null;
  const current = sourceValue(building, path);
  if (current === null) return { source, edited: true, gone: true };
  const edited = source.value !== undefined && !sameValue(source.value, current);
  return { source, edited, gone: false };
}

/** Every source of the building with its status, footprint first, openings last. */
export function sourceRows(building: Building): ({ path: SourcePath } & SourceStatus)[] {
  const order = ["footprint", "storeys", "roof", "sharedEdges", "constructions"];
  const paths = Object.keys(building.sources ?? {}).sort((a, b) => {
    const ia = order.indexOf(a);
    const ib = order.indexOf(b);
    return (ia === -1 ? order.length : ia) - (ib === -1 ? order.length : ib) || a.localeCompare(b);
  });
  return paths.flatMap((path) => {
    const status = sourceStatus(building, path);
    return status ? [{ path, ...status }] : [];
  });
}

/**
 * The building without openings that were only ever guessed (source "catalogue"): an older
 * hand-over put default windows on facades nobody photographed. Nobody measured or drew
 * them, so they are removed wherever such a building comes back.
 */
export function withoutGuessedOpenings(building: Building): Building {
  const guessed = (id: string) => building.sources?.[`opening:${id}`]?.kind === "catalogue";
  const ids = building.storeys.flatMap((s) => s.openings.map((o) => o.id)).filter(guessed);
  if (ids.length === 0) return building;
  const gone = new Set(ids);
  const sources = Object.fromEntries(
    Object.entries(building.sources ?? {}).filter(
      ([path]) => !gone.has(path.replace(/^opening:/, "")),
    ),
  );
  return {
    ...building,
    sources,
    storeys: building.storeys.map((s) => ({
      ...s,
      openings: s.openings.filter((o) => !gone.has(o.id)),
    })),
  };
}
