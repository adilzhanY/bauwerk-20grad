import type { VersionEntry } from "./useSync";
import { mergeSummaries } from "./summary";
import type { ChangeSummary } from "./summary";

/** A pause longer than this between one person's versions starts a new session. */
export const SESSION_GAP_MS = 15 * 60_000;

/**
 * One person's uninterrupted work, as one line of the history (TODO Part 21, CG.1): their
 * versions one after another with no pause over 15 minutes and nobody else in between.
 */
export interface Session {
  /** The newest version of the session, the one a click shows. */
  version: number;
  /** The oldest version of the session. */
  from: number;
  actor: string;
  actorId: string | null;
  /** When it began and ended (the oldest and newest version's times). */
  start: string;
  end: string;
  changes: number;
  summary: ChangeSummary;
  created: boolean;
}

/**
 * Groups a version list (newest first) into sessions. The creation always stands alone, and
 * another person's version in between ends a session.
 */
export function groupSessions(entries: readonly VersionEntry[]): Session[] {
  const sessions: Session[] = [];
  for (const entry of entries) {
    const last = sessions.at(-1);
    const same =
      last !== undefined &&
      !last.created &&
      entry.kind === "ops" &&
      last.actor === entry.actor &&
      Date.parse(last.start) - Date.parse(entry.createdAt) <= SESSION_GAP_MS;
    if (last && same) {
      last.from = entry.version;
      last.start = entry.createdAt;
      last.changes += entry.changes;
      last.summary = mergeSummaries(last.summary, entry.summary ?? {});
      continue;
    }
    sessions.push({
      version: entry.version,
      from: entry.version,
      actor: entry.actor,
      actorId: entry.actorId ?? null,
      start: entry.createdAt,
      end: entry.createdAt,
      changes: entry.changes,
      summary: entry.summary ?? {},
      created: entry.kind === "create",
    });
  }
  return sessions;
}
