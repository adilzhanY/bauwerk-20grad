/**
 * The thermal envelope as an area list (Hüllflächenaufstellung): every element type by
 * compass direction, with area, U-value, temperature correction factor and its share of the
 * transmission loss. This is the table an energy consultant types into the calculation
 * software (tabular envelope entry) after a site visit.
 *
 * It is grouped from the energy balance's own elements, so its areas and H_T are exactly the
 * ones the heating demand is computed from. Party walls, which lose no heat, are added from
 * the footprint edges marked as shared.
 */
import { computeEnergy, azimuthOf } from "./energy";
import type { EnergySummary } from "./energy";
import { edges } from "./polygon";
import { sharedEdgeSet } from "./shared";
import type { Building } from "./types";

export type AreaElement =
  "wall" | "window" | "door" | "roof" | "floor" | "interiorWall" | "partyWall";

/** Eight compass directions, clockwise from north. */
export const DIRECTIONS = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"] as const;
export type Direction = (typeof DIRECTIONS)[number];

export function directionOf(azimuth: number): Direction {
  const index = Math.round((((azimuth % 360) + 360) % 360) / 45) % 8;
  return DIRECTIONS[index] ?? "N";
}

export interface AreaRow {
  element: AreaElement;
  /** Null for elements without one direction: roof, floor, walls to unheated rooms. */
  direction: Direction | null;
  /** Degrees from horizontal: 90 for walls and windows, the roof pitch, 0 for floors. */
  tilt: number;
  /** m², summed over every storey. */
  area: number;
  uValue: number;
  /** Temperature correction factor: 1 to outside air, less to ground or unheated rooms. */
  fx: number;
  /** W/K. */
  ht: number;
  /** Number of pieces, for windows and doors. */
  count: number;
}

const ORDER: Record<AreaElement, number> = {
  wall: 0,
  window: 1,
  door: 2,
  roof: 3,
  floor: 4,
  interiorWall: 5,
  partyWall: 6,
};

/** The area list of `building`, sorted by element type and then clockwise from north. */
export function areaList(
  building: Building,
  energy: EnergySummary = computeEnergy(building),
): AreaRow[] {
  const pitch =
    building.roof?.kind && building.roof.kind !== "flat" ? (building.roof.pitch ?? 0) : 0;
  const rows = new Map<string, AreaRow>();
  const add = (row: Omit<AreaRow, "count">, pieces: number) => {
    const key = [
      row.element,
      row.direction,
      row.tilt,
      row.uValue.toFixed(3),
      row.fx.toFixed(3),
    ].join("|");
    const existing = rows.get(key);
    if (existing) {
      existing.area += row.area;
      existing.ht += row.ht;
      existing.count += pieces;
    } else rows.set(key, { ...row, count: pieces });
  };

  for (const e of energy.elements) {
    if (e.category === "bridge" || e.area <= 0) continue;
    const fx = e.uValue > 0 ? e.loss / (e.uValue * e.area) : 1;
    const direction = e.azimuth === undefined ? null : directionOf(e.azimuth);
    const element: AreaElement = e.category;
    const tilt = element === "roof" ? pitch : element === "floor" ? 0 : 90;
    add(
      { element, direction, tilt, area: e.area, uValue: e.uValue, fx, ht: e.loss },
      element === "window" || element === "door" ? 1 : 0,
    );
  }

  const shared = sharedEdgeSet(building);
  const rotation = building.origin?.rotation ?? 0;
  const wall = building.constructions.find((c) => c.id === building.wallConstructionId);
  for (const edge of edges(building.footprint)) {
    if (!shared.has(edge.index)) continue;
    const height = building.storeys.reduce((sum, s) => sum + s.height, 0);
    add(
      {
        element: "partyWall",
        direction: directionOf(azimuthOf(edge.normal, rotation)),
        tilt: 90,
        area: edge.length * height,
        uValue: wall?.uValue ?? 0,
        fx: 0,
        ht: 0,
      },
      0,
    );
  }

  return [...rows.values()].sort(
    (a, b) =>
      ORDER[a.element] - ORDER[b.element] ||
      (a.direction === null ? 8 : DIRECTIONS.indexOf(a.direction)) -
        (b.direction === null ? 8 : DIRECTIONS.indexOf(b.direction)) ||
      a.uValue - b.uValue,
  );
}

/**
 * The list as CSV for a spreadsheet or the calculation software: semicolons and decimal
 * commas in German, commas and points in English, a header row in the given words.
 */
export function areaListCsv(
  rows: readonly AreaRow[],
  words: {
    header: readonly string[];
    element: (e: AreaElement) => string;
    direction: (d: Direction) => string;
  },
  language: "en" | "de",
): string {
  const sep = language === "de" ? ";" : ",";
  const num = (v: number, digits: number) => {
    const text = v.toFixed(digits);
    return language === "de" ? text.replace(".", ",") : text;
  };
  const lines = rows.map((r) =>
    [
      words.element(r.element),
      r.direction === null ? "" : words.direction(r.direction),
      num(r.tilt, 0),
      num(r.area, 2),
      num(r.uValue, 2),
      num(r.fx, 2),
      num(r.ht, 2),
      r.count > 0 ? String(r.count) : "",
    ].join(sep),
  );
  return [words.header.join(sep), ...lines].join("\r\n") + "\r\n";
}
