/**
 * AdV code lists, vendored from the official GDI-DE registry so the UI can show
 * "Satteldach" rather than "3100".
 *
 * Source (regenerate with `npm run codelists:update`):
 *   https://repository.gdi-de.org/schemas/adv/citygml/Codelisten/RoofTypeTypeAdV.xml
 *   https://repository.gdi-de.org/schemas/adv/citygml/Codelisten/BuildingFunctionTypeAdV.xml
 *
 * These are vendored rather than fetched at runtime: they change roughly never, and an
 * ingest of millions of buildings should not depend on a third-party host being up.
 */
import data from './codelists.json' with { type: 'json' }
import english from './codelists.en.json' with { type: 'json' }

const roofTypes = data.roofType as Record<string, string>
const buildingFunctions = data.buildingFunction as Record<string, string>

/** e.g. "2100" -> "Pultdach". Returns null for codes absent from the AdV list. */
export function roofTypeLabel(code: string | null | undefined): string | null {
  if (!code) return null
  return roofTypes[code] ?? null
}

/** e.g. "31001_2460" -> "Gebäude zum Parken". */
export function buildingFunctionLabel(code: string | null | undefined): string | null {
  if (!code) return null
  return buildingFunctions[code] ?? null
}

/** English names for the roof forms and building functions, for a UI that is not in German. */
const ROOF_TYPE_EN: Record<string, string> = {
  '1000': 'Flat roof',
  '2100': 'Shed roof',
  '2200': 'Offset shed roof',
  '3100': 'Gable roof',
  '3200': 'Hip roof',
  '3300': 'Half-hip roof',
  '3400': 'Mansard roof',
  '3500': 'Pavilion roof',
  '3600': 'Conical roof',
  '3700': 'Domed roof',
  '3800': 'Sawtooth roof',
  '3900': 'Arched roof',
  '4000': 'Tower roof',
  '5000': 'Mixed form',
  '9999': 'Other',
}

/** e.g. "3100" -> "Gable roof". Falls back to the AdV German label, then to null. */
export function roofTypeLabelEn(code: string | null | undefined): string | null {
  if (!code) return null
  return ROOF_TYPE_EN[code] ?? roofTypes[code] ?? null
}

/**
 * Every code of the building function list in English (codelists.en.json, translated by hand,
 * not part of the registry download). A code the registry adds later falls back to German.
 */
const buildingFunctionsEn = english.buildingFunction as Record<string, string>

/** e.g. "31001_1010" -> "House". */
export function buildingFunctionLabelEn(code: string | null | undefined): string | null {
  if (!code) return null
  return buildingFunctionsEn[code] ?? buildingFunctions[code] ?? null
}

/**
 * Broad grouping for map styling and filtering. Derived from the ALKIS object-type
 * prefix: 31001 is Gebäude (buildings proper), while the 51000/52000/53000 ranges are
 * Bauwerke and other structures that happen to be modelled as buildings.
 */
export type FunctionGroup = 'residential' | 'commercial' | 'public' | 'utility' | 'other'

export function functionGroup(code: string | null | undefined): FunctionGroup {
  if (!code) return 'other'
  const [objectType, fn] = code.split('_')
  if (objectType !== '31001' || !fn) return 'utility'
  const n = Number(fn)
  if (!Number.isFinite(n)) return 'other'
  if (n >= 1000 && n < 2000) return 'residential'
  if (n >= 2000 && n < 3000) return 'commercial'
  if (n >= 3000 && n < 3100) return 'public'
  return 'other'
}

export const roofTypeCodes = Object.freeze({ ...roofTypes })
export const buildingFunctionCodes = Object.freeze({ ...buildingFunctions })
