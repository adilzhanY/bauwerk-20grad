import { describe, expect, it } from "vitest";
import { groupSessions } from "./history";
import type { VersionEntry } from "./useSync";

const entry = (version: number, actor: string, time: string, changes = 1): VersionEntry => ({
  version,
  actor,
  createdAt: `2026-09-26T${time}.000Z`,
  kind: version === 1 ? "create" : "ops",
  changes,
  summary: { walls: { added: 0, removed: 0, changed: changes } },
});

describe("groupSessions", () => {
  it("joins one person's work with pauses up to 15 minutes, and keeps the rest apart", () => {
    const sessions = groupSessions([
      entry(7, "Ada", "11:00:00"),
      entry(6, "Ada", "10:50:00", 2),
      entry(5, "Ada", "10:40:00"),
      entry(4, "Bob", "10:35:00"),
      entry(3, "Ada", "10:30:00"),
      // A pause of 20 minutes: a session of its own.
      entry(2, "Ada", "10:10:00"),
      entry(1, "Ada", "10:09:00", 0),
    ]);
    expect(sessions.map((s) => [s.version, s.from, s.actor, s.changes, s.created])).toEqual([
      [7, 5, "Ada", 4, false],
      [4, 4, "Bob", 1, false],
      [3, 3, "Ada", 1, false],
      [2, 2, "Ada", 1, false],
      [1, 1, "Ada", 0, true],
    ]);
    expect(sessions[0]?.summary.walls?.changed).toBe(4);
    expect(sessions[0]?.start).toBe("2026-09-26T10:40:00.000Z");
  });
});
