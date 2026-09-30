/**
 * What the state pays towards a renovation variant, by the rules of September 2026.
 *
 * Envelope, BEG Einzelmaßnahmen (BAFA): a measure is eligible only when the new element
 * meets the technical minimum requirements (TMA) for residential buildings. The rate is 15 %,
 * plus the iSFP bonus of 5 % when a funded iSFP exists and the eligible costs reach 30,000
 * euro (GModG, since 21 July 2026). Eligible costs are capped at 30,000 euro per dwelling and
 * year, 60,000 euro with an iSFP.
 *
 * Heating, KfW 458: a heat pump, a biomass boiler or a district heating connection. The base
 * rate is 30 %; owner-occupiers who replace a fossil or electric direct heating get the
 * climate speed bonus, 16 % until January 2027, then 12 % from February 2027, 8 % from August
 * 2027, 4 % from February 2028 and none from August 2028; the total is capped at 70 %. The income bonus (up to 40 %)
 * depends on the household's income and is left out. Eligible costs: 30,000 euro for the
 * first dwelling, 15,000 for the second to sixth, 8,000 from the seventh.
 *
 * Planning and site supervision (50 %) and the Effizienzhaus programme are not modelled.
 */
import { economicsOf } from "./supply";
import { heatingOf } from "./heating";
import type { Measure } from "./scenarios";
import type { Building, ConstructionCategory, EnergyCarrier } from "./types";

/** BEG EM technical minimum requirements, highest U-value in W/(m²K), residential. */
export const TMA_U: Record<ConstructionCategory, number> = {
  wall: 0.2,
  roof: 0.14,
  floor: 0.25,
  window: 0.95,
  door: 1.3,
};

export const ENVELOPE_RATE = 0.15;
export const ISFP_BONUS = 0.05;
/** Eligible envelope costs from which the iSFP bonus applies. */
export const ISFP_BONUS_MIN_COSTS = 30_000;
export const ENVELOPE_CAP_PER_DWELLING = 30_000;
export const ENVELOPE_CAP_PER_DWELLING_ISFP = 60_000;

export const HEATING_BASE_RATE = 0.3;
/** The climate speed bonus by the date its step starts, newest last. */
export const CLIMATE_SPEED_BONUS_STEPS: readonly (readonly [string, number])[] = [
  ["2024-01-01", 0.16],
  ["2027-02-01", 0.12],
  ["2027-08-01", 0.08],
  ["2028-02-01", 0.04],
  ["2028-08-01", 0],
];

/** The climate speed bonus for a heating replaced on `date`. */
export function climateSpeedBonus(date: Date): number {
  const day = date.toISOString().slice(0, 10);
  let bonus = 0;
  for (const [from, rate] of CLIMATE_SPEED_BONUS_STEPS) if (day >= from) bonus = rate;
  return bonus;
}
export const HEATING_MAX_RATE = 0.7;

/** Heating systems KfW 458 supports. */
const RENEWABLE: readonly EnergyCarrier[] = [
  "heatPumpAir",
  "heatPumpGround",
  "pellets",
  "districtHeat",
];
/** Heating systems whose replacement earns the climate speed bonus. */
const REPLACEABLE: readonly EnergyCarrier[] = ["gas", "oil", "liquidGas", "electric"];

/** KfW 458 eligible costs for a building with `dwellings` dwellings. */
export function heatingCostCap(dwellings: number): number {
  const n = Math.max(1, Math.floor(dwellings));
  return 30_000 + Math.min(n - 1, 5) * 15_000 + Math.max(0, n - 6) * 8_000;
}

export type SubsidyReason = "eligible" | "uTooHigh" | "notRenewable";

export interface MeasureSubsidy {
  measure: Measure;
  reason: SubsidyReason;
  /** The TMA limit for an envelope measure. */
  limit?: number;
  /** Euro this measure receives, its share of its programme's capped subsidy. */
  subsidy: number;
}

export interface SubsidySummary {
  measures: MeasureSubsidy[];
  /** Envelope rate applied, 0 when nothing is eligible. */
  envelopeRate: number;
  heatingRate: number;
  /** Euro in total, and what the owner pays. */
  total: number;
  ownShare: number;
}

/** The subsidy for `measures`, which turn `baseline` into a variant. */
export function subsidyOf(
  baseline: Building,
  measures: readonly Measure[],
  /** When the measures are carried out; the heating bonus falls from 2027. */
  date: Date = new Date(),
): SubsidySummary {
  const economics = economicsOf(baseline);
  const dwellings = Math.max(1, economics.dwellings);

  const envelope = measures.filter((m) => m.kind !== "heating");
  const envelopeOk = envelope.filter(
    (m) => m.uValue !== undefined && m.uValue <= TMA_U[m.kind as ConstructionCategory] + 1e-9,
  );
  const eligibleEnvelope = envelopeOk.reduce((s, m) => s + m.cost, 0);
  const cap =
    dwellings * (economics.isfp ? ENVELOPE_CAP_PER_DWELLING_ISFP : ENVELOPE_CAP_PER_DWELLING);
  const envelopeRate =
    eligibleEnvelope > 0
      ? ENVELOPE_RATE +
        (economics.isfp && eligibleEnvelope >= ISFP_BONUS_MIN_COSTS ? ISFP_BONUS : 0)
      : 0;
  const envelopeSubsidy = Math.min(eligibleEnvelope, cap) * envelopeRate;

  const heating = measures.find((m) => m.kind === "heating");
  const newCarrier = heating?.heating?.carrier;
  const heatingOk = newCarrier !== undefined && RENEWABLE.includes(newCarrier);
  const replacesFossil = REPLACEABLE.includes(heatingOf(baseline).carrier);
  const heatingRate = heatingOk
    ? Math.min(
        HEATING_MAX_RATE,
        HEATING_BASE_RATE +
          (economics.ownerOccupied && replacesFossil ? climateSpeedBonus(date) : 0),
      )
    : 0;
  const heatingSubsidy = heating
    ? Math.min(heating.cost, heatingCostCap(dwellings)) * heatingRate
    : 0;

  const result: MeasureSubsidy[] = measures.map((measure) => {
    if (measure.kind === "heating") {
      return {
        measure,
        reason: heatingOk ? "eligible" : "notRenewable",
        subsidy: heatingSubsidy,
      };
    }
    const limit = TMA_U[measure.kind];
    const ok = envelopeOk.includes(measure);
    return {
      measure,
      reason: ok ? "eligible" : "uTooHigh",
      limit,
      // The capped envelope subsidy, shared out by cost.
      subsidy: ok && eligibleEnvelope > 0 ? (envelopeSubsidy * measure.cost) / eligibleEnvelope : 0,
    };
  });

  const total = envelopeSubsidy + heatingSubsidy;
  const investment = measures.reduce((s, m) => s + m.cost, 0);
  return {
    measures: result,
    envelopeRate,
    heatingRate,
    total,
    ownShare: Math.max(0, investment - total),
  };
}
