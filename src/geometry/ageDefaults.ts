/**
 * Default U-values by building age, for an existing building nobody has measured yet: the
 * flat values of the rules for data collection in the existing residential stock
 * (Bekanntmachung der Regeln zur Datenaufnahme und Datenverwendung im Wohngebäudebestand,
 * BAnz AT 04.12.2020 B1), table 2 for opaque elements not insulated later, table 3 for
 * windows. The consultant picks the year and the kind of wall and window; every element gets
 * the value of its age class until a layer stack or a measurement replaces it.
 */
import type { Construction, ConstructionCategory } from "./types";

/** The nine age classes, by their last year; the last one runs on. */
export const AGE_CLASS_UNTIL = [1918, 1948, 1957, 1968, 1978, 1983, 1994, 2001, Infinity] as const;

/** The age class (0 to 8) of a building finished in `year`. */
export function ageClass(year: number): number {
  return AGE_CLASS_UNTIL.findIndex((until) => year <= until);
}

type Row = readonly (number | null)[];

/** Exterior walls, table 2; null where the table has no value for that age. */
export const WALL_KINDS = {
  brickSolidThin: [2.8, 2.8, 2.8, null, null, null, null, null, null],
  brickSolidMedium: [1.8, 1.8, 1.8, null, null, null, null, null, null],
  brickSolidThick: [1.5, 1.5, 1.5, null, null, null, null, null, null],
  brickHollow: [1.4, 1.4, 1.4, 1.4, 1.0, 0.8, 0.6, 0.5, 0.4],
  cavity: [1.3, 1.3, 1.3, 1.4, 1.0, 0.8, 0.6, 0.5, 0.4],
  timberFrame: [2.0, 2.0, 2.0, null, null, null, null, null, null],
  timberPanel: [0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.4, 0.4, 0.3],
} as const satisfies Record<string, Row>;
export type WallKind = keyof typeof WALL_KINDS;

/** Windows, table 3 (U_w), with the glazing g⊥ of each age. */
export const WINDOW_KINDS = {
  woodSingle: { u: [5.0, 5.0, 5.0, 5.0, 5.0, null, null, null, null], g: 0.87 },
  woodDouble: { u: [2.7, 2.7, 2.7, 2.7, 2.7, 2.7, 2.7, 1.6, 1.5], g: 0.75 },
  plastic: { u: [3.0, 3.0, 3.0, 3.0, 3.0, 3.0, 3.0, 1.9, 1.5], g: 0.75 },
  metal: { u: [4.3, 4.3, 4.3, 4.3, 4.3, 4.3, 3.2, 1.9, 1.5], g: 0.75 },
} as const satisfies Record<string, { u: Row; g: number }>;
export type WindowKind = keyof typeof WINDOW_KINDS;

/** Pitched roof of timber, table 2 (also walls between a heated and an unheated loft). */
const ROOF_TIMBER: Row = [2.6, 1.4, 1.4, 1.4, 0.8, 0.7, 0.5, 0.3, 0.2];
/** Top floor ceiling as a timber beam ceiling, under a cold attic. */
const CEILING_TIMBER: Row = [1.0, 1.0, 0.8, 0.7, 0.6, 0.4, 0.3, 0.3, 0.2];
/** Floor on the ground, solid reinforced concrete. */
const FLOOR_CONCRETE: Row = [1.6, 1.6, 2.3, 1.2, 1.2, 0.8, 0.6, 0.6, 0.5];
/** Doors of wood, wood based panels or plastic; metal doors are 4.0. */
const DOOR_WOOD = 2.9;

export interface AgeChoice {
  year: number;
  wall: WallKind;
  window: WindowKind;
  /** Whether the roof itself is the envelope (heated attic or flat) or the top floor ceiling. */
  roofIsEnvelope: boolean;
}

/** The first value of a row at or after the age class, for kinds the table stops giving. */
function valueAt(row: Row, index: number): number {
  for (let i = index; i >= 0; i--) {
    const v = row[i];
    if (v !== null && v !== undefined) return v;
  }
  return row.find((v) => v !== null) ?? 1;
}

/** Whether the table gives a value for this kind in this age class. */
export const wallKindFits = (kind: WallKind, year: number): boolean =>
  WALL_KINDS[kind][ageClass(year)] !== null;
export const windowKindFits = (kind: WindowKind, year: number): boolean =>
  WINDOW_KINDS[kind].u[ageClass(year)] !== null;

export const AGE_IDS: Record<ConstructionCategory, string> = {
  wall: "c_age_wall",
  roof: "c_age_roof",
  floor: "c_age_floor",
  window: "c_age_window",
  door: "c_age_door",
};

/** Names for the defaults, in both languages, with the U-value they carry. */
const NAMES: Record<ConstructionCategory, { en: string; de: string }> = {
  wall: { en: "Exterior wall, default for its age", de: "Außenwand, Pauschalwert nach Baujahr" },
  roof: { en: "Roof, default for its age", de: "Dach, Pauschalwert nach Baujahr" },
  floor: { en: "Floor slab, default for its age", de: "Bodenplatte, Pauschalwert nach Baujahr" },
  window: { en: "Windows, default for their age", de: "Fenster, Pauschalwert nach Baujahr" },
  door: { en: "Door, default for its age", de: "Tür, Pauschalwert nach Baujahr" },
};

/** The five default constructions for a building of this age and kind. */
export function ageConstructions(choice: AgeChoice, language: "en" | "de"): Construction[] {
  const i = Math.max(0, ageClass(choice.year));
  const window = WINDOW_KINDS[choice.window];
  const u: Record<ConstructionCategory, number> = {
    wall: valueAt(WALL_KINDS[choice.wall], i),
    roof: valueAt(choice.roofIsEnvelope ? ROOF_TIMBER : CEILING_TIMBER, i),
    floor: valueAt(FLOOR_CONCRETE, i),
    window: valueAt(window.u, i),
    door: DOOR_WOOD,
  };
  return (Object.keys(AGE_IDS) as ConstructionCategory[]).map((category) => ({
    id: AGE_IDS[category],
    name: NAMES[category][language],
    category,
    uValue: u[category],
    ...(category === "window" ? { gValue: window.g } : {}),
  }));
}

/** The name of an age default construction in `language`, or undefined for any other id. */
export function ageConstructionName(id: string, language: "en" | "de"): string | undefined {
  const category = (Object.keys(AGE_IDS) as ConstructionCategory[]).find((c) => AGE_IDS[c] === id);
  return category ? NAMES[category][language] : undefined;
}
