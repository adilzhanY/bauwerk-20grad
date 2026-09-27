import { describe, expect, it } from "vitest";
import { groupVersions } from "./history";
import type { VersionEntry } from "./useSync";

const entry = (version: number, actor: string, time: string, changes = 1): VersionEntry => ({
  version,
  actor,
  createdAt: `2026-09-26T${time}.000Z`,
  kind: version === 1 ? "create" : "ops",
  changes,
});

describe("groupVersions", () => {
  it("joins one person's versions within a minute and keeps the rest apart", () => {
    const groups = groupVersions([
      entry(6, "Ada", "10:05:40"),
      entry(5, "Ada", "10:05:10", 2),
      entry(4, "Bob", "10:05:05"),
      entry(3, "Ada", "10:04:59"),
      entry(2, "Ada", "10:04:30"),
      entry(1, "Ada", "10:04:00", 0),
    ]);
    expect(groups.map((g) => [g.version, g.from, g.actor, g.changes, g.created])).toEqual([
      [6, 5, "Ada", 3, false],
      [4, 4, "Bob", 1, false],
      [3, 2, "Ada", 2, false],
      [1, 1, "Ada", 0, true],
    ]);
  });
});
