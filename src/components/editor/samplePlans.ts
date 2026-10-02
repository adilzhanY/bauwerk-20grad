import type { Building } from "@/geometry/types";

/** Floor plans that come with the repository, named `<Gebäude-ID>-<storey>.png`. */
const SAMPLE_PLANS = import.meta.glob<string>("/lod2/sample-plans/*.png", {
  query: "?url",
  import: "default",
  eager: true,
});

/**
 * The sample plan of this building's storey, if the repository has one: `<gid>-EG.png` is the
 * ground floor (the lowest storey), `<gid>-OG1.png` the one above, and so on.
 */
export function samplePlanFor(
  building: Pick<Building, "id" | "project">,
  storeyIndex: number,
  plans: Record<string, string> = SAMPLE_PLANS,
): string | null {
  const gid =
    building.project?.gid ??
    (building.id.startsWith("lod2-") ? building.id.slice("lod2-".length) : null);
  if (!gid || storeyIndex < 0) return null;
  const code = storeyIndex === 0 ? "EG" : `OG${String(storeyIndex)}`;
  return plans[`/lod2/sample-plans/${gid}-${code}.png`] ?? null;
}
