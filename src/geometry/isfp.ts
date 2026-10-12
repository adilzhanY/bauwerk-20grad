/**
 * The numbers an individueller Sanierungsfahrplan (iSFP) shows, on top of the energy balance.
 *
 * Colour class: the seven iSFP colours on the non-renewable primary energy per m² A_N
 * (iSFP handbook, dena and ifeu): dark green up to 30, then 60, 90, 130, 180, 230, and dark red
 * above.
 *
 * Effizienzhaus level, envelope side: the building's H'T against the H'T of its reference
 * building, the same geometry with the reference U-values of GEG Anlage 1 (wall 0.28, roof and
 * top floor ceiling 0.20, floor 0.35, windows 1.3, doors 1.8, ΔU_WB 0.05). BEG Effizienzhaus
 * 40, 55, 70, 85, 100 and Denkmal allow 55, 70, 85, 100, 115 and 160 % of it. The primary
 * energy side of the level needs the certified DIN V 18599 proof and is not claimed here.
 *
 * Consumption: calculated demand overstates what an old house uses, since people heat an
 * uninsulated house more sparingly. The iSFP handbook (6.3.9) turns the calculated end energy
 * for heating and hot water q per m² of heated living area into a typical consumption with
 *   f = −0.2 + 1.3 / (1 + q / 500), at least 0.4
 *   above 60 kWh/(m²a):  q_m = 30 + f · (q − 30);   below:  q_m = (1 + f) / 2 · q
 * (the formula for DIN V 4108-6 balances with combined heating and hot water). The factor
 * describes how people heat a house of that envelope, not the generator, so a heat pump,
 * whose performance factor would distort q, gets the factor of the same heat through a
 * standard gas boiler; the handbook leaves heat pumps to other methods, this is ours.
 * Measured bills, when entered, set the level: every variant is scaled by the ratio of the
 * measured consumption to the typical one of the building as it is.
 */
import { computeEnergy } from "./energy";
import type { EnergySummary } from "./energy";
import { DEFAULT_HEATING, endEnergyOf, heatingOf } from "./heating";
import { economicsOf, livingAreaOf, priceWithCo2Of, supplyOf } from "./supply";
import type { SupplySummary } from "./supply";
import type { Building, Construction, ConstructionCategory } from "./types";

// Colour class ---------------------------------------------------------------------------

/** Upper bounds of the first six iSFP colour classes, kWh/(m²a) primary energy. */
export const ISFP_CLASS_UPPER = [30, 60, 90, 130, 180, 230] as const;
/** From dark green to dark red, as the iSFP prints them. */
export const ISFP_CLASS_COLORS = [
  "#1b7a3a",
  "#3aa150",
  "#9ccc4a",
  "#e8c21e",
  "#ee8a1c",
  "#d9451f",
  "#8e1a1a",
] as const;

/** 0 (dark green) to 6 (dark red) for a primary energy per m² A_N. */
export function isfpClass(primaryPerM2: number): number {
  const i = ISFP_CLASS_UPPER.findIndex((upper) => primaryPerM2 <= upper);
  return i === -1 ? ISFP_CLASS_UPPER.length : i;
}

// Effizienzhaus level, envelope side --------------------------------------------------------

export const REFERENCE_U: Record<ConstructionCategory, number> = {
  wall: 0.28,
  roof: 0.2,
  floor: 0.35,
  window: 1.3,
  door: 1.8,
};
export const REFERENCE_BRIDGE_SURCHARGE = 0.05;

/** Effizienzhaus levels and the share of the reference H'T each allows. */
export const EH_LEVELS = [
  { name: "40", share: 0.55 },
  { name: "55", share: 0.7 },
  { name: "70", share: 0.85 },
  { name: "85", share: 1.0 },
  { name: "100", share: 1.15 },
  { name: "Denkmal", share: 1.6 },
] as const;

export type EhLevel = (typeof EH_LEVELS)[number]["name"];

/** The building with every envelope element at its GEG reference U-value. */
export function referenceBuilding(building: Building): Building {
  const ref = (category: ConstructionCategory): Construction => ({
    id: `ref_${category}`,
    name: `Reference ${category}`,
    category,
    uValue: REFERENCE_U[category],
    ...(category === "window" ? { gValue: 0.6 } : {}),
  });
  const categories = ["wall", "roof", "floor", "window", "door"] as const;
  return {
    ...building,
    constructions: [...building.constructions, ...categories.map(ref)],
    wallConstructionId: "ref_wall",
    roofConstructionId: "ref_roof",
    floorConstructionId: "ref_floor",
    windowConstructionId: "ref_window",
    doorConstructionId: "ref_door",
    bridgeMethod: "flat",
    bridgeSurcharge: REFERENCE_BRIDGE_SURCHARGE,
    storeys: building.storeys.map((s) => ({
      ...s,
      openings: s.openings.map((o) =>
        o.interior ? o : { ...o, constructionId: o.kind === "window" ? "ref_window" : "ref_door" },
      ),
    })),
  };
}

export interface EhCheck {
  /** H'T of the building and of its reference building, W/(m²K). */
  ht: number;
  reference: number;
  /** ht / reference. */
  ratio: number;
  /** The best level whose H'T limit the building meets, or null when it meets none. */
  level: EhLevel | null;
}

export function ehCheck(building: Building, energy = computeEnergy(building)): EhCheck {
  const reference = computeEnergy(referenceBuilding(building)).specificTransmissionLoss;
  const ht = energy.specificTransmissionLoss;
  const ratio = reference > 0 ? ht / reference : Infinity;
  const level = EH_LEVELS.find((l) => ratio <= l.share + 1e-9)?.name ?? null;
  return { ht, reference, ratio, level };
}

// Consumption --------------------------------------------------------------------------------

export { livingAreaOf } from "./supply";

/** The iSFP calibration factor for a calculated end energy per m² of living area. */
export function typicalFactor(q: number): number {
  return Math.max(0.4, -0.2 + 1.3 / (1 + q / 500));
}

/** The typical consumption per m² of living area for a calculated end energy per m². */
export function typicalConsumption(q: number): number {
  const f = typicalFactor(q);
  return q > 60 ? 30 + f * (q - 30) : ((1 + f) / 2) * q;
}

export type ConsumptionSource = "bills" | "typical";

export interface Consumption {
  /** Where the level comes from: the bills entered, or the typical formula. */
  source: ConsumptionSource;
  /** End energy for heating and hot water, kWh/a: calculated, and expected in use. */
  calculated: number;
  expected: number;
  /** expected / calculated. */
  factor: number;
  /** Euro per year at today's prices, expected: heat in use plus auxiliary electricity. */
  cost: number;
}

/** The expected consumption without bills, kWh/a: the typical one. */
function unbilled(
  building: Building,
  supply: SupplySummary,
  energy: Pick<EnergySummary, "referenceArea">,
): number {
  const heat = supply.endParts.heating + supply.endParts.hotWater;
  const living = livingAreaOf(building, energy);
  if (living <= 0 || heat <= 0) return heat;
  const heating = heatingOf(building);
  // A heat pump is judged by the end energy a standard gas boiler would need for its heat.
  const boiler = heating.carrier.startsWith("heatPump")
    ? endEnergyOf(
        {
          ...DEFAULT_HEATING,
          hotWater: heating.hotWater,
          distributionLoss: heating.distributionLoss,
        },
        supply.heatingDemand,
        energy.referenceArea,
      )
    : supply.endParts;
  const q = (boiler.heating + boiler.hotWater) / living;
  return q > 0 ? heat * (typicalConsumption(q) / q) : heat;
}

/**
 * What `building` is expected to use and cost in a year. `current` is the building as it is
 * today, for a variant: bills measured on today's building scale the variant too.
 */
export function consumptionOf(
  building: Building,
  supply: SupplySummary,
  energy: Pick<EnergySummary, "referenceArea">,
  current?: {
    building: Building;
    supply: SupplySummary;
    energy: Pick<EnergySummary, "referenceArea">;
  },
): Consumption {
  const today = current ?? { building, supply, energy };
  const heat = supply.endParts.heating + supply.endParts.hotWater;
  const measured = economicsOf(today.building).consumption;
  let expected = unbilled(building, supply, energy);
  let source: ConsumptionSource = "typical";
  if (measured !== undefined && measured > 0) {
    const base = unbilled(today.building, today.supply, today.energy);
    expected *= base > 0 ? measured / base : 1;
    source = "bills";
  }
  const carrier = heatingOf(building).carrier;
  const cost =
    expected * priceWithCo2Of(building, carrier) +
    supply.endParts.auxiliary * priceWithCo2Of(building, "electric");
  return { source, calculated: heat, expected, factor: heat > 0 ? expected / heat : 1, cost };
}

/** Consumption of the building as it is, from its own balance. */
export function currentConsumption(
  building: Building,
  energy = computeEnergy(building),
): Consumption {
  return consumptionOf(building, supplyOf(building, energy), energy);
}
