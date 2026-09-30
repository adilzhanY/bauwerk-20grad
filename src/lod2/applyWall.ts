/**
 * One photographed facade of the building page, taken into the 3D editor.
 *
 * The building page computes the whole Bauwerk building from the survey (analysis.ts). Its
 * openings measured on facade photo wall `surfaceIndex` carry stable ids `w<surface>-o<n>`
 * (lod2-core, toBauwerkOpening), all on the one footprint edge the wall stands on.
 *
 * When the editor already holds this building, perhaps edited since, only that edge changes:
 * its openings on every storey are replaced by the survey's, with their sources, and
 * everything else stays as the consultant left it, apart from windows an older version guessed
 * on facades nobody photographed (source "catalogue"): nobody measured or drew those, so they
 * go. Otherwise the editor gets the whole building, as "Sanierungsplanung starten" does.
 */
import type { Building, Opening } from "@/geometry/types";

export interface WallTakeover {
  building: Building;
  /** The footprint edge the facade stands on. */
  edge: number;
  /** True when only that edge changed in the editor's own building. */
  merged: boolean;
}

const fromWall = (surfaceIndex: number) => (o: Opening) =>
  o.id.startsWith(`w${String(surfaceIndex)}-o`);

/** The footprint edge the survey put wall `surfaceIndex`'s openings on, or null without any. */
export function surveyedEdge(survey: Building, surfaceIndex: number): number | null {
  const opening = survey.storeys.flatMap((s) => s.openings).find(fromWall(surfaceIndex));
  return opening ? opening.wallIndex : null;
}

export function takeOverWall(
  current: Building | null,
  survey: Building,
  surfaceIndex: number,
): WallTakeover | null {
  const edge = surveyedEdge(survey, surfaceIndex);
  if (edge === null) return null;
  if (current?.id !== survey.id || current.footprint.length !== survey.footprint.length) {
    return { building: survey, edge, merged: false };
  }
  const onEdge = (o: Opening) => !o.interior && o.wallIndex === edge;
  const guessed = (o: Opening) => current.sources?.[`opening:${o.id}`]?.kind === "catalogue";
  const sources = { ...current.sources };
  for (const o of current.storeys.flatMap((s) => s.openings).filter(guessed)) {
    // eslint-disable-next-line @typescript-eslint/no-dynamic-delete -- sources are keyed by opening id
    delete sources[`opening:${o.id}`];
  }
  const storeys = current.storeys.map((storey) => {
    // Storeys match by id; a storey the consultant added has no survey counterpart.
    const surveyed = survey.storeys.find((s) => s.id === storey.id);
    const kept = storey.openings.filter((o) => !guessed(o));
    if (!surveyed) return { ...storey, openings: kept };
    for (const old of storey.openings.filter(onEdge)) {
      // eslint-disable-next-line @typescript-eslint/no-dynamic-delete -- sources are keyed by opening id
      delete sources[`opening:${old.id}`];
    }
    const taken = surveyed.openings.filter(onEdge);
    for (const o of taken) {
      const source = survey.sources?.[`opening:${o.id}`];
      if (source) sources[`opening:${o.id}`] = source;
    }
    return { ...storey, openings: [...kept.filter((o) => !onEdge(o)), ...taken] };
  });
  return { building: { ...current, storeys, sources }, edge, merged: true };
}
