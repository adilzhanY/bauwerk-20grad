import { findConstruction } from "./constructions";
import { roofOf } from "./roof";
import type { Building, Construction, ConstructionCategory } from "./types";

/**
 * Requirements of the Gebäudeenergiegesetz (GEG) for changes to existing
 * buildings, Annex 7 table 1, residential: the maximum U-value an element may
 * have after it has been renovated. These are the numbers a consultant checks
 * first, and the ones a funding application refers to.
 *
 *   exterior wall 0.24, pitched roof and top floor ceiling 0.24, flat roof 0.20, floor
 *   against ground or unheated cellar 0.30, windows 1.3, exterior doors 1.8 W/(m²K)
 */
export const GEG_MAX_U: Record<ConstructionCategory, number> = {
  wall: 0.24,
  roof: 0.24,
  floor: 0.3,
  window: 1.3,
  door: 1.8,
};

/** Annex 7: a flat roof (sealed with a membrane) has its own, stricter limit. */
export const GEG_MAX_U_FLAT_ROOF = 0.2;

export interface GegCheck {
  category: ConstructionCategory;
  construction: Construction | undefined;
  uValue: number;
  limit: number;
  /** U at or below the limit. False when the construction is missing. */
  ok: boolean;
  /** Ratio of U to the limit, 1 means exactly on the line. */
  ratio: number;
}

export function checkConstruction(
  c: Construction | undefined,
  category: ConstructionCategory,
  limit = GEG_MAX_U[category],
): GegCheck {
  const uValue = c?.uValue ?? Number.POSITIVE_INFINITY;
  return {
    category,
    construction: c,
    uValue,
    limit,
    ok: c !== undefined && uValue <= limit + 1e-9,
    ratio: c ? uValue / limit : Number.POSITIVE_INFINITY,
  };
}

/** The five assigned constructions of a building against the GEG limits. */
export function gegChecks(building: Building): GegCheck[] {
  const pick = (id: string) => findConstruction(building.constructions, id);
  return [
    checkConstruction(pick(building.wallConstructionId), "wall"),
    checkConstruction(
      pick(building.roofConstructionId),
      "roof",
      roofOf(building).kind === "flat" ? GEG_MAX_U_FLAT_ROOF : GEG_MAX_U.roof,
    ),
    checkConstruction(pick(building.floorConstructionId), "floor"),
    checkConstruction(pick(building.windowConstructionId), "window"),
    checkConstruction(pick(building.doorConstructionId), "door"),
  ];
}

export const gegPassCount = (checks: readonly GegCheck[]): number =>
  checks.filter((c) => c.ok).length;
