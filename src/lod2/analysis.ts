/**
 * Everything the building page shows about one building part, computed with the editor's own
 * code: the part and its surveyed facades become a Bauwerk building (lod2-core writes it,
 * a facade has openings only where a photo shows them), and Bauwerk's energy balance,
 * heat load and the roof's PV estimate run on it. The same building is what "Sanierungsplanung
 * starten" loads into the editor, so the page and the editor never disagree.
 */
import type { BuildingDetail, Neighbour } from "lod2-core/api";
import { estimatePv, surveyToBauwerk } from "lod2-core/survey";
import type { NeighbourFootprint, PvEstimate, SurveyReport } from "lod2-core/survey";
import { computeEnergy } from "@/geometry/energy";
import type { EnergySummary } from "@/geometry/energy";
import { fromJson } from "@/geometry/export";
import { buildingHeatLoad } from "@/geometry/hvac";
import type { Building } from "@/geometry/types";
import type { Language } from "@/i18n";
import { localizeBuilding } from "@/i18n/localizeBuilding";
import { surveyText } from "./messages";
import type { BuildingSurvey } from "./state/survey";

export interface BuildingAnalysis {
  /** The building as the editor receives it. */
  building: Building;
  energy: EnergySummary;
  /** Design heat load, W. */
  heatLoad: number;
  pv: PvEstimate;
  report: SurveyReport;
}

export type AnalysisResult =
  { ok: true; analysis: BuildingAnalysis } | { ok: false; reason: string };

/** Berlin is in UTM zone 33, the only state wired up. */
const UTM_ZONE = 33;

export function analyzePart(
  detail: BuildingDetail,
  partGid: string,
  survey: BuildingSurvey,
  neighbours: readonly Neighbour[],
  language: Language,
): AnalysisResult {
  const walls = Object.values(survey.walls)
    .filter((w) => w.partGid === partGid)
    .map((w) => ({
      surfaceIndex: w.surfaceIndex,
      method: w.method,
      ...(w.photo ? { photo: w.photo } : {}),
      openings: w.openings.map((o) => ({
        kind: o.kind ?? ("window" as const),
        x: o.x,
        y: o.y,
        width: o.width,
        height: o.height,
        ...(o.score !== undefined ? { score: o.score } : {}),
      })),
    }));
  const result = surveyToBauwerk({
    building: detail,
    partGid,
    facts: survey.facts,
    walls,
    neighbours: neighbourFootprints(neighbours),
    utmZone: UTM_ZONE,
    // Openings only where a photo shows them. A facade nobody photographed may or may not
    // have windows; guessing them from the default rule put windows on side and back walls
    // that have none, so an unphotographed wall stays closed until someone measures it.
    fillMissingWindows: false,
  });
  if (!result.ok)
    return { ok: false, reason: surveyText(result.message, language) ?? result.reason };
  // Through the editor's own importer, so the page computes on exactly what the editor loads.
  const imported = fromJson(JSON.stringify(result.file), language);
  if (!imported.ok) return { ok: false, reason: `Bauwerk: ${imported.error.code}` };
  // The survey names things in German; the editor shows them in its language.
  const building = localizeBuilding(imported.building, language);
  const energy = computeEnergy(building);
  const part = detail.parts.find((p) => p.gid === partGid);
  const pv = estimatePv(
    (part?.roofPlanes ?? []).map((plane) => ({
      area: plane.area3d,
      azimuth: plane.azimuth,
      tilt: plane.tilt,
    })),
  );
  return {
    ok: true,
    analysis: {
      building,
      energy,
      heatLoad: buildingHeatLoad(energy),
      pv,
      report: result.report,
    },
  };
}

/** The parts that have geometry, largest first: each gets a tab on the building page. */
export function partsWithGeometry(detail: BuildingDetail): BuildingDetail["parts"] {
  return detail.parts
    .filter((p) => p.hasGeometry && p.mesh)
    .sort((a, b) => (b.footprintArea ?? 0) - (a.footprintArea ?? 0));
}

/** The ground rings of the neighbours, which lod2-core needs to find the party walls. */
function neighbourFootprints(neighbours: readonly Neighbour[]): NeighbourFootprint[] {
  return neighbours.flatMap((n) => {
    if (!n.mesh) return [];
    const grounds = n.mesh.surfaces.flatMap((s) =>
      s.kind === "ground" && s.rings[0] ? [s.rings[0]] : [],
    );
    return grounds.length ? [{ origin: n.mesh.origin, grounds }] : [];
  });
}
