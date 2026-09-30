/**
 * Window types as an energy consultant meets them on site, with the flat U-values of the
 * rules for data collection in the existing residential stock (Bekanntmachung der Regeln zur
 * Datenaufnahme und Datenverwendung im Wohngebäudebestand) for the old ones and typical
 * values for new ones. Single, double and triple glazing are the default presets every
 * building already has; the others join a building's constructions when first chosen.
 */
import { PRESET_IDS } from "./constructions";
import type { Construction } from "./types";

export interface WindowType {
  id: string;
  /** Uw in W/(m²K). */
  uValue: number;
  /** Total solar energy transmittance g⊥ of the glazing, DIN V 4108-6 table 6. */
  g: number;
  en: string;
  de: string;
  /** When windows like this were built, in both languages. */
  era: { en: string; de: string };
}

export const WINDOW_TYPES: readonly WindowType[] = [
  {
    id: PRESET_IDS.glazingSingle,
    uValue: 5.0,
    g: 0.87,
    en: "Single glazing",
    de: "Einfachverglasung",
    era: { en: "before 1960", de: "vor 1960" },
  },
  {
    id: "c_glazing_box",
    uValue: 2.7,
    g: 0.76,
    en: "Box window, two single panes",
    de: "Kastenfenster, zwei Einfachscheiben",
    era: { en: "old buildings before 1950", de: "Altbau vor 1950" },
  },
  {
    id: PRESET_IDS.glazingDouble,
    uValue: 2.8,
    g: 0.75,
    en: "Double glazing",
    de: "Zweifachverglasung",
    era: { en: "insulating glass 1970 to 1994", de: "Isolierglas 1970 bis 1994" },
  },
  {
    id: "c_glazing_1995",
    uValue: 1.6,
    g: 0.6,
    en: "Thermal glazing, 1995 to 2010",
    de: "Wärmeschutzverglasung, 1995 bis 2010",
    era: { en: "1995 to 2010", de: "1995 bis 2010" },
  },
  {
    id: "c_glazing_2010",
    uValue: 1.3,
    g: 0.6,
    en: "Double thermal glazing, from 2010",
    de: "Zweifach-Wärmeschutzverglasung, ab 2010",
    era: { en: "from 2010", de: "ab 2010" },
  },
  {
    id: PRESET_IDS.glazingTriple,
    uValue: 0.8,
    g: 0.5,
    en: "Triple glazing",
    de: "Dreifachverglasung",
    era: { en: "today, meets the BEG limit", de: "heute, erfüllt die BEG-Grenze" },
  },
];

export function windowType(id: string): WindowType | undefined {
  return WINDOW_TYPES.find((w) => w.id === id);
}

/** The construction a window type becomes in a building. */
export function windowConstruction(type: WindowType, language: "en" | "de"): Construction {
  return {
    id: type.id,
    name: type[language],
    category: "window",
    uValue: type.uValue,
    gValue: type.g,
  };
}
