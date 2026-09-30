/**
 * What the Projects page shows about a building: a card's title, use, size, energy class,
 * stage and the four steps. Pure, so the server computes the same summary for its list as the
 * browser does for projects kept locally.
 *
 * The stage follows the work done unless the consultant set it by hand: a saved scenario means
 * the project is at its variants, an opened report means at its report. "Done" is only ever set
 * by hand.
 */
import { computeEnergy } from "./energy";
import type { EnergyClass } from "./energy";
import type { Building, GeoOrigin, ProjectStage, Vec2 } from "./types";

export const PROJECT_STAGES: readonly ProjectStage[] = ["survey", "variants", "report", "done"];

export interface ProjectSummary {
  /** The address, or the building's name when there is none. */
  title: string;
  /** What the building is used for (LoD2 function), without the Gebäude-ID. */
  use: string | null;
  storeys: number;
  client: string | null;
  gid: string | null;
  energyClass: EnergyClass;
  /** kWh per m² and year. */
  endEnergy: number;
  stage: ProjectStage;
  /** Survey, Model, Variants, Report: which of the four steps have been done. */
  steps: [boolean, boolean, boolean, boolean];
  origin: GeoOrigin | null;
  /** For the plan thumbnail of a project without a photo. */
  footprint: Vec2[];
}

export function projectSummary(building: Building): ProjectSummary {
  const info = building.project ?? {};
  const energy = computeEnergy(building);
  const openings = building.storeys.reduce((n, s) => n + s.openings.length, 0);
  const photographed = Object.values(building.sources ?? {}).some((s) => s.kind === "photo");
  const steps: ProjectSummary["steps"] = [
    photographed,
    building.storeys.length > 0 && openings > 0,
    (building.scenarios?.length ?? 0) > 0,
    info.reportAt !== undefined,
  ];
  const derived: ProjectStage = steps[3] ? "report" : steps[2] ? "variants" : "survey";
  const use = info.gid ? building.name.replace(info.gid, "").trim() : null;
  return {
    title: info.address ?? building.name,
    use: use === null || use === "" ? null : use,
    storeys: building.storeys.length,
    client: info.client ?? null,
    gid: info.gid ?? null,
    energyClass: energy.energyClass,
    endEnergy: energy.specificEndEnergy,
    stage: info.stage ?? derived,
    steps,
    origin: building.origin ?? null,
    footprint: building.footprint,
  };
}
