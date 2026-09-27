/**
 * The lod2-core fixtures (a building, its surveyed wall and its neighbours) for tests. Not a
 * test file itself, so tests in other folders can share it.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { BuildingDetailSchema, NeighbourSchema } from "lod2-core/api";
import { z } from "zod";
import type { BuildingSurvey } from "./state/survey";

// Tests run from the repository root; jsdom rewrites import.meta.url, so a plain path it is.
const FIXTURES = join(process.cwd(), "lod2", "lod2-core", "fixtures");

export function loadFixture(gid: string) {
  const detail = BuildingDetailSchema.parse(
    JSON.parse(readFileSync(join(FIXTURES, "buildings", `${gid}.json`), "utf8")),
  );
  const survey = JSON.parse(readFileSync(join(FIXTURES, "surveys", `${gid}.json`), "utf8")) as {
    partGid: string;
    surfaceIndex: number;
    openings: BuildingSurvey["walls"][string]["openings"];
    photo: string;
  };
  // The neighbour fixture holds ground rings only; wrap them as API neighbours.
  const rings = z
    .array(
      z.object({
        buildingGid: z.string(),
        origin: z.array(z.number()),
        grounds: z.array(z.array(z.number())),
      }),
    )
    .parse(JSON.parse(readFileSync(join(FIXTURES, "neighbours", `${gid}.json`), "utf8")));
  const neighbours = rings.map((n) =>
    NeighbourSchema.parse({
      buildingGid: n.buildingGid,
      distance: 0,
      roofTypeCode: null,
      mesh: {
        origin: n.origin,
        terrain: [],
        surfaces: n.grounds.map((r) => ({ kind: "ground", rings: [r] })),
      },
    }),
  );
  return { detail, survey, neighbours };
}

/** The fixture's photographed wall as a survey, the way the facade section stores it. */
export function surveyFromFixture(
  survey: ReturnType<typeof loadFixture>["survey"],
): BuildingSurvey {
  return {
    facts: { ageClass: "bis1918", ageClassConfirmed: false },
    walls: {
      [`${survey.partGid}:${String(survey.surfaceIndex)}`]: {
        partGid: survey.partGid,
        surfaceIndex: survey.surfaceIndex,
        openings: survey.openings,
        photo: survey.photo,
        method: "detected",
        updatedAt: 0,
      },
    },
  };
}
