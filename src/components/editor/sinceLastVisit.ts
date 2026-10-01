import { mergeSummaries } from "@/sync/summary";
import type { ChangeSummary } from "@/sync/summary";
import type { VersionEntry } from "@/sync/useSync";

/** What one other person did since this person was last in the project. */
export interface SinceEntry {
  actor: string;
  versions: number;
  summary: ChangeSummary;
}

/**
 * The others' changes since `lastSeenAt` (TODO Part 21, CG.4), per person, and the version the
 * project was at then (to compare with now). Own changes and the creation do not count.
 */
export function sinceLastVisit(
  entries: readonly VersionEntry[],
  lastSeenAt: string,
  me: string | null,
): { people: SinceEntry[]; from: number } | null {
  const seen = Date.parse(lastSeenAt);
  const newer = entries.filter(
    (e) => e.kind === "ops" && Date.parse(e.createdAt) > seen && e.actorId !== me,
  );
  if (newer.length === 0) return null;
  const people = new Map<string, SinceEntry>();
  for (const entry of newer) {
    const known = people.get(entry.actor);
    if (known) {
      known.versions += 1;
      known.summary = mergeSummaries(known.summary, entry.summary ?? {});
    } else {
      people.set(entry.actor, { actor: entry.actor, versions: 1, summary: entry.summary ?? {} });
    }
  }
  const before = entries.filter((e) => Date.parse(e.createdAt) <= seen);
  const from = Math.max(1, ...before.map((e) => e.version));
  return { people: [...people.values()], from };
}
