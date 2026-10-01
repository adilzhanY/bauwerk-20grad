/**
 * Default U-values by construction age, for the parts of a building nobody has opened up.
 *
 * Source: Bekanntmachung der Regeln zur Datenaufnahme und Datenverwendung im
 * Wohngebäudebestand of 8 October 2020, BAnz AT 04.12.2020 B1 (BMWi and BMI), table 2 for the
 * opaque parts that have not been insulated later and table 3 for windows. The rows used:
 *
 *   wall    Außenwand massiv, zweischalig ohne Dämmschicht; before 1958 the solid brick row
 *           "Vollziegel, über 30 cm" instead, the typical Berlin tenement wall
 *   roof    Dach, Holzkonstruktion
 *   floor   Kellerdecke, Ziegel oder Hohlstein
 *   window  Holz, zwei Scheiben (Kastenfenster or Verbundfenster, the Berlin old-stock window)
 *   door    Türen, Holz, Holzwerkstoff oder Kunststoff, 2.9 for every class
 *
 * They are starting values that the consultant overrides with what they find on site.
 */

import { SURVEY_DE } from './messages.ts'

export type AgeClassId =
  | 'bis1918'
  | '1919-1948'
  | '1949-1957'
  | '1958-1968'
  | '1969-1978'
  | '1979-1983'
  | '1984-1994'
  | '1995-2001'
  | 'ab2002'

export interface AgeClass {
  id: AgeClassId
  label: string
  /** Default U-values in W/(m²K). */
  u: { wall: number; roof: number; floor: number; window: number; door: number }
  /** Floor-to-floor height typical for the class, metres. */
  storeyHeight: number
  /** Short names of the assumed constructions, in German; the keys are in messages.ts. */
  names: { wall: string; roof: string; floor: string; window: string; door: string }
}

const DOOR_U = 2.9
const OLD_WALL = SURVEY_DE['survey.construction.oldWall']
const CAVITY_WALL = SURVEY_DE['survey.construction.cavityWall']
const DOUBLE = SURVEY_DE['survey.construction.windowDouble']
const INSULATED = SURVEY_DE['survey.construction.windowInsulated']
const ROOF = SURVEY_DE['survey.construction.roof']
const FLOOR = SURVEY_DE['survey.construction.floor']
const DOOR = SURVEY_DE['survey.construction.door']

export const AGE_CLASSES: readonly AgeClass[] = [
  ageClass('bis1918', 1.5, 2.6, 1.2, 2.7, 3.1, OLD_WALL, DOUBLE),
  ageClass('1919-1948', 1.5, 1.4, 1.2, 2.7, 3.1, OLD_WALL, DOUBLE),
  ageClass('1949-1957', 1.5, 1.4, 1.5, 2.7, 2.8, OLD_WALL, DOUBLE),
  ageClass('1958-1968', 1.4, 1.4, 1.0, 2.7, 2.8, CAVITY_WALL, DOUBLE),
  ageClass('1969-1978', 1.0, 0.8, 1.0, 2.7, 2.8, CAVITY_WALL, DOUBLE),
  ageClass('1979-1983', 0.8, 0.7, 0.8, 2.7, 2.8, CAVITY_WALL, DOUBLE),
  ageClass('1984-1994', 0.6, 0.5, 0.6, 2.7, 2.8, CAVITY_WALL, DOUBLE),
  ageClass('1995-2001', 0.5, 0.3, 0.6, 1.6, 2.8, CAVITY_WALL, INSULATED),
  ageClass('ab2002', 0.4, 0.2, 0.5, 1.5, 2.8, CAVITY_WALL, INSULATED),
]

function ageClass(
  id: AgeClassId,
  wall: number,
  roof: number,
  floor: number,
  window: number,
  storeyHeight: number,
  wallName: string,
  windowName: string,
): AgeClass {
  return {
    id,
    label: SURVEY_DE[`survey.ageClass.${id}`],
    u: { wall, roof, floor, window, door: DOOR_U },
    storeyHeight,
    names: { wall: wallName, roof: ROOF, floor: FLOOR, window: windowName, door: DOOR },
  }
}

/** Used when the user has not said: most of Berlin's inner-city housing is pre-1918. */
export const DEFAULT_AGE_CLASS: AgeClassId = 'bis1918'

export function ageClassById(id: AgeClassId): AgeClass {
  const found = AGE_CLASSES.find((c) => c.id === id)
  if (!found) throw new Error(`Unknown age class ${id}`)
  return found
}

/** The class a construction year falls into, after footnote 1: the year of completion decides. */
export function ageClassForYear(year: number): AgeClassId {
  if (year <= 1918) return 'bis1918'
  if (year <= 1948) return '1919-1948'
  if (year <= 1957) return '1949-1957'
  if (year <= 1968) return '1958-1968'
  if (year <= 1978) return '1969-1978'
  if (year <= 1983) return '1979-1983'
  if (year <= 1994) return '1984-1994'
  if (year <= 2001) return '1995-2001'
  return 'ab2002'
}
