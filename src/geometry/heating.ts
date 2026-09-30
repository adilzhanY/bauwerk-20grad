/**
 * The heating system of a building and the data of each energy carrier. Its own module so
 * the energy balance (energy.ts) and the money side (supply.ts) can both use it.
 *
 * Factors, as of September 2026:
 *   primary energy  GEG Anlage 4, non-renewable part (district heat: a typical network value,
 *                   the supplier's certificate replaces it). From 1 January 2027 the GModG
 *                   lowers grid electricity to 1.5 and raises biomass to 0.7; both sets are
 *                   here and the building says which one it is calculated with.
 *   CO2 (GEG)       GEG Anlage 9, g CO2-equivalent per kWh, upstream chain included
 *   CO2 (bill)      BEHG fuel factors as billed, kg per kWh of the billed gross value; this
 *                   is the CO2 the price applies to and the CO2KostAufG counts
 *   prices          2026 averages for households (BDEW, Verbraucherzentrale), editable
 *
 * From useful heat to end energy, in the manner of DIN V 4701-10 kept simple: heating and hot
 * water each pass the distribution (pipes and storage, a share of the useful heat) and then
 * the generator, each with its own efficiency; pumps and controls draw auxiliary electricity.
 * Typical values for the existing stock, starting points a consultant replaces.
 */
import type { Building, EnergyCarrier, FactorSet, HeatingSystem } from "./types";

export interface CarrierData {
  /** Non-renewable primary energy factor, GEG 2024. */
  primary: number;
  /** kg CO2-equivalent per kWh end energy, GEG Anlage 9. */
  emission: number;
  /** kg CO2 per kWh the BEHG prices; 0 where no CO2 price is billed to the household. */
  billedCo2: number;
  /** Euro per kWh, household average 2026. */
  price: number;
  /** A typical annual efficiency for heating, or seasonal performance factor for heat pumps. */
  efficiency: number;
  /** The same for hot water: lower, since a boiler or heat pump works hotter for it. */
  hotWaterEfficiency: number;
  /** Auxiliary electricity for pumps, burner and controls, kWh per m² A_N and year. */
  auxiliary: number;
}

export const CARRIERS: Record<EnergyCarrier, CarrierData> = {
  gas: {
    primary: 1.1,
    emission: 0.24,
    billedCo2: 0.182,
    price: 0.11,
    efficiency: 0.92,
    hotWaterEfficiency: 0.85,
    auxiliary: 1.5,
  },
  oil: {
    primary: 1.1,
    emission: 0.31,
    billedCo2: 0.266,
    price: 0.1,
    efficiency: 0.85,
    hotWaterEfficiency: 0.8,
    auxiliary: 2,
  },
  liquidGas: {
    primary: 1.1,
    emission: 0.27,
    billedCo2: 0.235,
    price: 0.13,
    efficiency: 0.9,
    hotWaterEfficiency: 0.83,
    auxiliary: 1.5,
  },
  districtHeat: {
    primary: 0.7,
    emission: 0.18,
    billedCo2: 0,
    price: 0.15,
    efficiency: 0.98,
    hotWaterEfficiency: 0.95,
    auxiliary: 0.5,
  },
  pellets: {
    primary: 0.2,
    emission: 0.02,
    billedCo2: 0,
    price: 0.07,
    efficiency: 0.85,
    hotWaterEfficiency: 0.78,
    auxiliary: 2.5,
  },
  heatPumpAir: {
    primary: 1.8,
    emission: 0.56,
    billedCo2: 0,
    price: 0.24,
    efficiency: 3.0,
    hotWaterEfficiency: 2.3,
    auxiliary: 0.5,
  },
  heatPumpGround: {
    primary: 1.8,
    emission: 0.56,
    billedCo2: 0,
    price: 0.24,
    efficiency: 4.0,
    hotWaterEfficiency: 3.0,
    auxiliary: 0.8,
  },
  electric: {
    primary: 1.8,
    emission: 0.56,
    billedCo2: 0,
    price: 0.35,
    efficiency: 1.0,
    hotWaterEfficiency: 1.0,
    auxiliary: 0,
  },
};

/** Primary energy factors that change with the GModG from 1 January 2027. */
const PRIMARY_GMODG_2027: Partial<Record<EnergyCarrier, number>> = {
  heatPumpAir: 1.5,
  heatPumpGround: 1.5,
  electric: 1.5,
  pellets: 0.7,
  districtHeat: 0.7,
};

export const FACTOR_SETS: FactorSet[] = ["geg2024", "gmodg2027"];

export const factorSetOf = (building: Building): FactorSet => building.factorSet ?? "geg2024";

/** The non-renewable primary energy factor of a carrier under a factor set. */
export function primaryFactor(carrier: EnergyCarrier, set: FactorSet): number {
  return (
    (set === "gmodg2027" ? PRIMARY_GMODG_2027[carrier] : undefined) ?? CARRIERS[carrier].primary
  );
}

export const CARRIER_ORDER: EnergyCarrier[] = [
  "gas",
  "oil",
  "liquidGas",
  "districtHeat",
  "pellets",
  "heatPumpAir",
  "heatPumpGround",
  "electric",
];

/** Hot water, kWh per m² A_N and year: the standard value of DIN V 4108-6 for dwellings. */
export const HOT_WATER_PER_M2 = 12.5;
/** Losses of pipes and storage, as a share of the useful heat: an existing, partly insulated net. */
export const DISTRIBUTION_LOSS = 0.1;
/** A building without a heating system entered heats with a gas boiler. */
export const DEFAULT_HEATING: HeatingSystem = {
  carrier: "gas",
  efficiency: CARRIERS.gas.efficiency,
  hotWater: HOT_WATER_PER_M2,
};

export function heatingOf(building: Building): HeatingSystem {
  return building.heating ?? DEFAULT_HEATING;
}

/** The hot water efficiency: entered, or the carrier's ratio applied to the heating efficiency. */
export function hotWaterEfficiencyOf(heating: HeatingSystem): number {
  const c = CARRIERS[heating.carrier];
  return heating.hotWaterEfficiency ?? heating.efficiency * (c.hotWaterEfficiency / c.efficiency);
}

/** End energy per year, kWh: heating and hot water in the carrier, auxiliary in electricity. */
export interface EndEnergy {
  heating: number;
  hotWater: number;
  auxiliary: number;
  /** All three: the end energy the Energieausweis reports. */
  total: number;
}

/** The end energy for a heating demand, over the reference area `area` (A_N). */
export function endEnergyOf(
  heating: HeatingSystem,
  heatingDemand: number,
  area: number,
): EndEnergy {
  const loss = 1 + (heating.distributionLoss ?? DISTRIBUTION_LOSS);
  const heat = (heatingDemand * loss) / Math.max(heating.efficiency, 0.1);
  const hotWater = (heating.hotWater * area * loss) / Math.max(hotWaterEfficiencyOf(heating), 0.1);
  const auxiliary = CARRIERS[heating.carrier].auxiliary * area;
  return { heating: heat, hotWater, auxiliary, total: heat + hotWater + auxiliary };
}
