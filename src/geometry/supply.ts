/**
 * From heat demand to what the building buys, emits and costs: the heating system turns the
 * useful heat (heating demand plus hot water) into end energy; the carrier's factors give
 * primary energy and CO2; prices give the yearly cost; the CO2 on the bill decides, for a
 * rented building, how the CO2 cost is split between landlord and tenant.
 *
 * The carriers and their factors are in heating.ts; the CO2KostAufG steps are below.
 *
 * Pure: no store, no Three.js.
 */
import { computeEnergy, energyClass } from "./energy";
import type { EnergyClass, EnergySummary } from "./energy";
import { CARRIERS, endEnergyOf, factorSetOf, heatingOf, primaryFactor } from "./heating";
import type { EndEnergy } from "./heating";
import type { Building, Economics, EnergyCarrier, HeatingSystem } from "./types";

export { CARRIERS, CARRIER_ORDER, DEFAULT_HEATING, heatingOf } from "./heating";

/** Euro per tonne, the middle of the BEHG corridor for 2026. */
export const CO2_PRICE = 60;
/** VAT on the CO2 cost a household pays. */
export const VAT = 0.19;

export const DEFAULT_ECONOMICS: Economics = {
  prices: {},
  co2Price: CO2_PRICE,
  ownerOccupied: true,
  dwellings: 1,
  isfp: false,
};

export function economicsOf(building: Building): Economics {
  return { ...DEFAULT_ECONOMICS, ...building.economics };
}

/** Euro per kWh for a carrier: the building's own price, or the 2026 average. */
export function priceOf(building: Building, carrier: EnergyCarrier): number {
  return economicsOf(building).prices[carrier] ?? CARRIERS[carrier].price;
}

/**
 * Euro per kWh the yearly cost counts: the price moved by the CO2 price setting. Carrier
 * prices, own or default, are taken to include the CO2 price at CO2_PRICE.
 */
export function priceWithCo2Of(building: Building, carrier: EnergyCarrier): number {
  const extra = economicsOf(building).co2Price - CO2_PRICE;
  return priceOf(building, carrier) + ((CARRIERS[carrier].billedCo2 * extra) / 1000) * (1 + VAT);
}

/** CO2KostAufG annex: upper bounds in kg CO2 per m² and year, landlord share below each. */
const CO2_STEPS: readonly (readonly [number, number])[] = [
  [12, 0],
  [17, 0.1],
  [22, 0.2],
  [27, 0.3],
  [32, 0.4],
  [37, 0.5],
  [42, 0.6],
  [47, 0.7],
  [52, 0.8],
];

/** Living area per m² A_N when none is entered: the Energieausweis relation A_N = 1.2 · living. */
const LIVING_PER_REFERENCE = 1 / 1.2;

export const livingAreaOf = (building: Building, energy: Pick<EnergySummary, "referenceArea">) =>
  building.livingArea ?? energy.referenceArea * LIVING_PER_REFERENCE;

/** The landlord's share of the CO2 cost for `kgPerM2` of billed CO2 per m² and year. */
export function landlordCo2Share(kgPerM2: number): number {
  for (const [upper, share] of CO2_STEPS) if (kgPerM2 < upper) return share;
  return 0.95;
}

export interface SupplySummary {
  heating: HeatingSystem;
  /** kWh/a. */
  heatingDemand: number;
  /** Useful heat for hot water, kWh/a. */
  hotWater: number;
  /** End energy, kWh/a, all parts. */
  endEnergy: number;
  /** End energy by part: heating and hot water in the carrier, auxiliary electricity. */
  endParts: EndEnergy;
  primaryEnergy: number;
  /** kg CO2-equivalent per year, GEG factors. */
  co2: number;
  /** Per m² of reference area (A_N) and year. */
  endPerM2: number;
  primaryPerM2: number;
  co2PerM2: number;
  /** Energieausweis class from end energy, as for residential buildings. */
  /** None without a heated floor area. */
  energyClass: EnergyClass | null;
  /** Euro per year for the end energy, CO2 included, as calculated (not calibrated). */
  cost: number;
  /** Euro per year of it that is the BEHG CO2 price, VAT included. */
  co2Cost: number;
  /** kg of CO2 per m² of living area and year that the CO2 price is billed on. */
  billedCo2PerM2: number;
  /** Share of co2Cost the landlord carries when rented (CO2KostAufG), 0 when owner-occupied. */
  landlordShare: number;
}

/** What the building buys, emits and costs in a year. */
export function supplyOf(
  building: Building,
  energy: Pick<EnergySummary, "heatingDemand" | "referenceArea"> = computeEnergy(building),
): SupplySummary {
  const heating = heatingOf(building);
  const carrier = CARRIERS[heating.carrier];
  const electric = CARRIERS.electric;
  const set = factorSetOf(building);
  const economics = economicsOf(building);
  const area = energy.referenceArea;
  const parts = endEnergyOf(heating, energy.heatingDemand, area);
  const inCarrier = parts.heating + parts.hotWater;
  const perM2 = (value: number) => (area > 0 ? value / area : 0);
  const primaryEnergy =
    inCarrier * primaryFactor(heating.carrier, set) +
    parts.auxiliary * primaryFactor("electric", set);
  const co2 = inCarrier * carrier.emission + parts.auxiliary * electric.emission;
  const billedCo2 = inCarrier * carrier.billedCo2;
  const co2Cost = (billedCo2 / 1000) * economics.co2Price * (1 + VAT);
  // CO2KostAufG steps are per m² of living area, not A_N.
  const living = livingAreaOf(building, energy);
  const billedCo2PerM2 = living > 0 ? billedCo2 / living : 0;
  return {
    heating,
    heatingDemand: energy.heatingDemand,
    hotWater: heating.hotWater * area,
    endEnergy: parts.total,
    endParts: parts,
    primaryEnergy,
    co2,
    endPerM2: perM2(parts.total),
    primaryPerM2: perM2(primaryEnergy),
    co2PerM2: perM2(co2),
    energyClass: energy.referenceArea > 0 ? energyClass(perM2(parts.total)) : null,
    cost:
      inCarrier * priceWithCo2Of(building, heating.carrier) +
      parts.auxiliary * priceWithCo2Of(building, "electric"),
    co2Cost,
    billedCo2PerM2,
    landlordShare: economics.ownerOccupied ? 0 : landlordCo2Share(billedCo2PerM2),
  };
}
