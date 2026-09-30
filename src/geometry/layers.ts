import type { Building, Construction, ConstructionKind, Layer } from "./types";

/**
 * Layered constructions. The U-value follows DIN EN ISO 6946:
 *   R_T = R_si + Σ (d_i / λ_i) + R_se,   U = 1 / R_T
 * Surface resistances in m²K/W: walls 0.13 inside and 0.04 outside; roofs
 * 0.10 and 0.04 (upward heat flow); ground floors 0.17 inside and 0.00 to the
 * ground; interior walls 0.13 on both sides, both faces being inside. Windows and doors are products, not layer stacks, and keep a typed U.
 */

export const SURFACE_RESISTANCE: Record<ConstructionKind, { rsi: number; rse: number }> = {
  wall: { rsi: 0.13, rse: 0.04 },
  interiorWall: { rsi: 0.13, rse: 0.13 },
  roof: { rsi: 0.1, rse: 0.04 },
  floor: { rsi: 0.17, rse: 0 },
  window: { rsi: 0.13, rse: 0.04 },
  door: { rsi: 0.13, rse: 0.04 },
};

export const LAYERED_CATEGORIES: ConstructionKind[] = ["wall", "interiorWall", "roof", "floor"];

/** Thermal resistance of the layers alone, m²K/W. */
export function layersResistance(layers: readonly Layer[]): number {
  return layers.reduce((r, l) => r + (l.conductivity > 0 ? l.thickness / l.conductivity : 0), 0);
}

export function uValueFromLayers(layers: readonly Layer[], category: ConstructionKind): number {
  const { rsi, rse } = SURFACE_RESISTANCE[category];
  const total = rsi + layersResistance(layers) + rse;
  return total > 0 ? Math.round((1 / total) * 1000) / 1000 : 0;
}

export const totalThickness = (layers: readonly Layer[]): number =>
  Math.round(layers.reduce((s, l) => s + l.thickness, 0) * 1e6) / 1e6;

/** Returns the construction with `uValue` brought in line with its layers. */
export function withComputedU(c: Construction): Construction {
  return c.layers && c.layers.length > 0
    ? { ...c, uValue: uValueFromLayers(c.layers, c.category) }
    : c;
}

/**
 * Exterior wall thickness: the wall construction's layer stack when it has one,
 * otherwise the building's typed wall thickness.
 */
export function effectiveWallThickness(building: Building): number {
  const c = building.constructions.find((x) => x.id === building.wallConstructionId);
  if (c?.layers && c.layers.length > 0) return totalThickness(c.layers);
  return building.wallThickness;
}

/** Material classes for hatching in the cross-section drawing. */
export type MaterialClass =
  "masonry" | "concrete" | "insulation" | "plaster" | "timber" | "membrane" | "other";

export function materialClass(name: string, conductivity: number): MaterialClass {
  const n = name.toLowerCase();
  if (/dämm|insul|wool|wolle|eps|xps|pur|pir|cellulose|zellulose/.test(n)) return "insulation";
  if (/putz|plaster|render|gips|gypsum/.test(n)) return "plaster";
  if (/beton|concrete/.test(n)) return "concrete";
  if (/holz|timber|wood|osb|board|platte/.test(n)) return "timber";
  if (/bitumen|folie|membrane|sperre|barrier/.test(n)) return "membrane";
  if (/ziegel|brick|mauer|stein|kalksand|porenbeton|aerated|masonry/.test(n)) return "masonry";
  return conductivity < 0.1 ? "insulation" : "other";
}
