import { bestInCategory } from "./constructions";
import { bridgeSurchargeOf, computeEnergy, roofEnvelope, thermalRoof } from "./energy";
import type { EnergySummary } from "./energy";
import { area } from "./polygon";
import { consumptionOf } from "./isfp";
import type { Consumption } from "./isfp";
import { subsidyOf } from "./subsidy";
import type { SubsidySummary } from "./subsidy";
import { heatingOf, supplyOf } from "./supply";
import type { SupplySummary } from "./supply";
import type {
  Building,
  Construction,
  ConstructionCategory,
  ConstructionKind,
  EnergyCarrier,
  HeatingSystem,
  Scenario,
} from "./types";

/**
 * Renovation scenarios are override sets on top of the current building: which
 * construction each category uses, the thermal bridge detailing, and optionally
 * the roof. A change to the baseline flows into every variant.
 *
 * Costs are rough gross prices for the German market in 2025, per square metre
 * of element for walls, roof, floor and windows and per piece for doors, in the
 * range of the BKI Baukosten index and public renovation cost guides; they are
 * starting points a consultant replaces, marked as such.
 * Saving per year is the difference in expected energy cost: the end energy of the heating
 * system turned into the consumption an iSFP expects (isfp.ts), at the carrier's price, CO2
 * included. A variant may also replace the heating system; its rough installed cost is in
 * HEATING_COST. Part of every investment would be due anyway, render that is old, a boiler at
 * the end of its life: the Sowieso costs (SOWIESO_SHARE), which an iSFP shows apart from the
 * energy related costs.
 */

export type { Scenario };

export interface ScenarioResult {
  scenario: Scenario;
  energy: EnergySummary;
  /** Euro. */
  investment: number;
  /** Euro per year against the baseline. */
  savingPerYear: number;
  /** Years, Infinity when nothing is saved. */
  payback: number;
  /** kWh/a saved. */
  demandSaved: number;
  /** End energy, primary energy, CO2 and cost of the variant. */
  supply: SupplySummary;
  /** BEG and KfW subsidy for its measures, and what the owner pays. */
  subsidy: SubsidySummary;
  /** Years until the saving pays back the own share, Infinity when nothing is saved. */
  paybackOwnShare: number;
  /** Euro of the investment that would be due anyway (Sowieso-Kosten). */
  sowieso: number;
  /** Expected consumption and cost of the variant, and of the building today. */
  consumption: Consumption;
  currentConsumption: Consumption;
}

/**
 * Installed cost by construction preset id: €/m² of element for walls, roof, floor
 * and windows, € per door. Unknown ids cost the category default.
 */
export const CONSTRUCTION_COST: Record<string, number> = {
  c_wall_insulated: 180,
  c_wall_1970: 120,
  c_roof_insulated: 200,
  c_floor_insulated: 90,
  c_glazing_triple: 700,
  c_glazing_2010: 550,
  c_glazing_1995: 500,
  c_glazing_double: 500,
  c_door_insulated: 2200,
};
/** Fallback cost per category, same units as CONSTRUCTION_COST (€/m², doors € per piece). */
export const CATEGORY_DEFAULT_COST: Record<ConstructionKind, number> = {
  wall: 170,
  /** A new drywall: interior walls are no renovation measure, but a type has a price. */
  interiorWall: 90,
  roof: 190,
  floor: 90,
  window: 600,
  door: 2000,
};
/**
 * Share of a measure's cost that maintenance would need anyway, Sowieso-Kosten in the iSFP:
 * new render and scaffold on a facade, a new roof covering, windows and doors and a boiler at
 * the end of their life. Starting points for old elements, which a consultant sets per case.
 */
export const SOWIESO_SHARE: Record<ConstructionCategory | "heating", number> = {
  wall: 0.3,
  roof: 0.4,
  floor: 0,
  window: 0.5,
  door: 0.5,
  heating: 0.5,
};

/**
 * Installed cost of a new heating system for one dwelling, euro, 2026 market (heat pumps
 * after the price drop, boilers without chimney work). A consultant replaces it with the
 * offer; the order of magnitude is what the payback needs.
 */
export const HEATING_COST: Record<EnergyCarrier, number> = {
  gas: 12_000,
  oil: 14_000,
  liquidGas: 13_000,
  districtHeat: 12_000,
  pellets: 26_000,
  heatPumpAir: 30_000,
  heatPumpGround: 42_000,
  electric: 8_000,
};

export function costOf(construction: Construction): number {
  return CONSTRUCTION_COST[construction.id] ?? CATEGORY_DEFAULT_COST[construction.category];
}

const keyOf: Record<ConstructionCategory, keyof Building> = {
  wall: "wallConstructionId",
  floor: "floorConstructionId",
  roof: "roofConstructionId",
  window: "windowConstructionId",
  door: "doorConstructionId",
};

/** The building with the scenario's overrides applied. */
export function applyScenario(building: Building, scenario: Scenario): Building {
  const b: Building = {
    ...building,
    storeys: building.storeys.map((s) => ({ ...s, openings: s.openings.map((o) => ({ ...o })) })),
  };
  for (const category of ["wall", "floor", "roof"] as const) {
    const id = scenario.overrides[category];
    if (id && b.constructions.some((c) => c.id === id))
      (b as unknown as Record<string, unknown>)[keyOf[category]] = id;
  }
  for (const kind of ["window", "door"] as const) {
    const id = scenario.overrides[kind];
    if (!id || !b.constructions.some((c) => c.id === id)) continue;
    (b as unknown as Record<string, unknown>)[keyOf[kind]] = id;
    for (const s of b.storeys)
      for (const o of s.openings) if (o.kind === kind) o.constructionId = id;
  }
  if (scenario.bridgeDetail) b.bridgeDetail = scenario.bridgeDetail;
  // Under the flat method good detailing lowers ΔU_WB to 0.05, never raises it.
  if (scenario.bridgeSurcharge !== undefined) b.bridgeSurcharge = scenario.bridgeSurcharge;
  else if (scenario.bridgeDetail === "good" && building.bridgeSurcharge !== undefined)
    b.bridgeSurcharge = Math.min(bridgeSurchargeOf(building), 0.05);
  if (scenario.roof) b.roof = { ...building.roof, ...scenario.roof };
  if (scenario.heating) b.heating = scenario.heating;
  return b;
}

/** The built-in "full envelope" variant: best construction in every category and good details. */
export function fullEnvelopeScenario(building: Building): Scenario {
  const overrides: Scenario["overrides"] = {};
  for (const c of ["wall", "floor", "roof", "window", "door"] as const) {
    const best = bestInCategory(building.constructions, c);
    if (best) overrides[c] = best.id;
  }
  return { id: "full-envelope", name: "Full envelope", overrides, bridgeDetail: "good" };
}

export function evaluateScenario(
  building: Building,
  scenario: Scenario,
  baseline = computeEnergy(building),
): ScenarioResult {
  const variant = applyScenario(building, scenario);
  const energy = computeEnergy(variant);
  const measures = measuresOf(building, variant, energy);
  const investment = Math.round(measures.reduce((sum, m) => sum + m.cost, 0));
  const demandSaved = Math.max(0, baseline.heatingDemand - energy.heatingDemand);
  const supply = supplyOf(variant, energy);
  const today = { building, supply: supplyOf(building, baseline), energy: baseline };
  const current = consumptionOf(building, today.supply, baseline);
  const consumption = consumptionOf(variant, supply, energy, today);
  const savingPerYear = Math.max(0, current.cost - consumption.cost);
  const subsidy = subsidyOf(building, measures);
  return {
    supply,
    subsidy,
    sowieso: Math.round(measures.reduce((sum, m) => sum + m.sowieso, 0)),
    consumption,
    currentConsumption: current,
    paybackOwnShare: savingPerYear > 0 ? subsidy.ownShare / savingPerYear : Infinity,
    scenario,
    energy,
    investment,
    savingPerYear,
    payback: savingPerYear > 0 ? investment / savingPerYear : Infinity,
    demandSaved,
  };
}

/** One thing a variant changes, with what it costs. */
export interface Measure {
  kind: ConstructionCategory | "heating";
  /** Euro. */
  cost: number;
  /** Euro of it that would be due anyway. */
  sowieso: number;
  /** Element area in m² (doors: count), 0 for heating. */
  quantity: number;
  /** The new construction's U-value, for envelope measures. */
  uValue?: number;
  /** The new heating system, for a heating measure. */
  heating?: HeatingSystem;
}

/**
 * What a variant changes against the baseline: the wall, roof and floor wherever their
 * construction differs, costed by element area; every window and door whose own construction
 * differs, costed by the area (windows) or count (doors) that really changes; and a new
 * heating system, costed per dwelling.
 */
export function measuresOf(
  baseline: Building,
  variant: Building,
  energy = computeEnergy(variant),
): Measure[] {
  // Under a cold attic the insulation goes on the top floor ceiling, over the whole plan.
  const top = roofEnvelope(variant);
  const quantity: Record<"wall" | "roof" | "floor", number> = {
    wall: energy.wallNetArea,
    roof: top.through === "ceiling" ? area(variant.footprint) : thermalRoof(variant).area,
    floor: energy.storeys[0]?.floorArea ?? 0,
  };
  const measure = (
    kind: ConstructionCategory,
    amount: number,
    cost: number,
    uValue: number,
  ): Measure => ({ kind, cost, sowieso: cost * SOWIESO_SHARE[kind], quantity: amount, uValue });
  const measures: Measure[] = [];
  for (const category of ["wall", "roof", "floor"] as const) {
    const id = (variant as unknown as Record<string, string>)[keyOf[category]];
    if ((baseline as unknown as Record<string, string>)[keyOf[category]] === id) continue;
    const construction = variant.constructions.find((c) => c.id === id) ?? {
      id: "",
      name: "",
      category,
      uValue: 1,
    };
    measures.push(
      measure(
        category,
        quantity[category],
        quantity[category] * costOf(construction),
        construction.uValue,
      ),
    );
  }
  // Openings: only the ones whose construction the variant really changes. Windows are
  // priced per m², doors per piece; the U-value is the area weighted mean of the new ones.
  for (const kind of ["window", "door"] as const) {
    let amount = 0;
    let cost = 0;
    let glazed = 0;
    let ua = 0;
    variant.storeys.forEach((storey, i) => {
      for (const o of storey.openings) {
        if (o.kind !== kind || o.interior) continue;
        const was = baseline.storeys[i]?.openings.find((x) => x.id === o.id);
        if (was?.constructionId === o.constructionId) continue;
        const c = variant.constructions.find((x) => x.id === o.constructionId);
        if (!c) continue;
        const size = o.width * o.height;
        const unit = kind === "window" ? size : 1;
        amount += unit;
        cost += unit * costOf(c);
        glazed += size;
        ua += c.uValue * size;
      }
    });
    if (amount > 0) measures.push(measure(kind, amount, cost, ua / glazed));
  }
  const before = heatingOf(baseline);
  const after = heatingOf(variant);
  if (after.carrier !== before.carrier || after.efficiency !== before.efficiency) {
    const cost = HEATING_COST[after.carrier] * Math.max(1, variant.economics?.dwellings ?? 1);
    measures.push({
      kind: "heating",
      cost,
      sowieso: cost * SOWIESO_SHARE.heating,
      quantity: 0,
      heating: after,
    });
  }
  return measures;
}

export function evaluateAll(building: Building): ScenarioResult[] {
  const baseline = computeEnergy(building);
  const list = [fullEnvelopeScenario(building), ...(building.scenarios ?? [])];
  return list.map((s) => evaluateScenario(building, s, baseline));
}

export interface RoadmapStep {
  index: number;
  scenario: Scenario;
  /** Years after the start; the first step is year 0. */
  year: number;
  /** The building after this and all earlier steps. */
  energy: EnergySummary;
  /** Euro for this step alone. */
  investment: number;
  /** Euro for this and all earlier steps. */
  cumulativeInvestment: number;
  /** Euro per year against the original building, after this step. */
  savingPerYear: number;
  /** kWh/a this step saves against the previous one. */
  demandSaved: number;
  /** End energy, primary energy, CO2 and cost after this step. */
  supply: SupplySummary;
  /** Euro of this step's investment that would be due anyway. */
  sowieso: number;
  /** Expected consumption and yearly cost after this step. */
  consumption: Consumption;
}

/**
 * A renovation roadmap in the manner of the individueller Sanierungsfahrplan
 * (iSFP): the saved scenarios ordered by their own payback, cheapest win first,
 * applied one after another so every step shows the building as it will be
 * after everything before it. Later overrides win over earlier ones. Without
 * saved scenarios the full envelope variant is the single step.
 */
export function buildRoadmap(building: Building, yearsBetweenSteps = 3): RoadmapStep[] {
  const baseline = computeEnergy(building);
  const own = building.scenarios ?? [];
  const ordered =
    own.length === 0
      ? [fullEnvelopeScenario(building)]
      : [...own].sort(
          (a, b) =>
            evaluateScenario(building, a, baseline).payback -
            evaluateScenario(building, b, baseline).payback,
        );
  const today = { building, supply: supplyOf(building, baseline), energy: baseline };
  const currentCost = consumptionOf(building, today.supply, baseline).cost;
  const steps: RoadmapStep[] = [];
  let current = building;
  let previousEnergy = baseline;
  let cumulative = 0;
  ordered.forEach((scenario, index) => {
    const next = applyScenario(current, scenario);
    const energy = computeEnergy(next);
    const measures = measuresOf(current, next, energy);
    const investment = Math.round(measures.reduce((sum, m) => sum + m.cost, 0));
    cumulative += investment;
    const supply = supplyOf(next, energy);
    const consumption = consumptionOf(next, supply, energy, today);
    steps.push({
      index,
      scenario,
      year: index * yearsBetweenSteps,
      energy,
      investment,
      cumulativeInvestment: cumulative,
      supply,
      sowieso: Math.round(measures.reduce((sum, m) => sum + m.sowieso, 0)),
      consumption,
      savingPerYear: Math.max(0, currentCost - consumption.cost),
      demandSaved: Math.max(0, previousEnergy.heatingDemand - energy.heatingDemand),
    });
    current = next;
    previousEnergy = energy;
  });
  return steps;
}
