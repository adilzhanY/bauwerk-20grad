import type { VersionEntry } from "./useSync";

/** Versions one person made within one minute, shown as one line of the history. */
export interface VersionGroup {
  /** The newest version of the group, the one a click shows. */
  version: number;
  /** The oldest version of the group. */
  from: number;
  actor: string;
  /** The newest version's time. */
  createdAt: string;
  changes: number;
  created: boolean;
}

/**
 * Groups a version list (newest first) into lines: the versions one person made in the same
 * minute, one after another, become one line. The creation always stands alone.
 */
export function groupVersions(entries: readonly VersionEntry[]): VersionGroup[] {
  const groups: VersionGroup[] = [];
  for (const entry of entries) {
    const last = groups.at(-1);
    const sameMinute = last?.createdAt.slice(0, 16) === entry.createdAt.slice(0, 16);
    if (last && !last.created && entry.kind === "ops" && last.actor === entry.actor && sameMinute) {
      last.from = entry.version;
      last.changes += entry.changes;
      continue;
    }
    groups.push({
      version: entry.version,
      from: entry.version,
      actor: entry.actor,
      createdAt: entry.createdAt,
      changes: entry.changes,
      created: entry.kind === "create",
    });
  }
  return groups;
}
