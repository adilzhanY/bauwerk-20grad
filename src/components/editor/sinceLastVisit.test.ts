import { describe, expect, it } from "vitest";
import { sinceLastVisit } from "./sinceLastVisit";

const entry = (version: number, actor: string, actorId: string, at: string) => ({
  version,
  actor,
  actorId,
  createdAt: `2026-10-01T${at}.000Z`,
  kind: "ops" as const,
  changes: 1,
  summary: { walls: { added: 0, removed: 0, changed: 1 } },
});

describe("since your last visit", () => {
  it("names the others' changes after the last visit, per person, and the version then", () => {
    const result = sinceLastVisit(
      [
        entry(6, "Lena Berg", "lena", "12:00:00"),
        entry(5, "Ada Test", "ada", "11:30:00"),
        entry(4, "Lena Berg", "lena", "11:00:00"),
        entry(3, "Tom Wagner", "tom", "09:00:00"),
      ],
      "2026-10-01T10:00:00.000Z",
      "ada",
    );
    expect(result?.from).toBe(3);
    expect(result?.people.map((p) => [p.actor, p.versions, p.summary.walls?.changed])).toEqual([
      ["Lena Berg", 2, 2],
    ]);
    expect(
      sinceLastVisit([entry(3, "Tom", "tom", "09:00:00")], "2026-10-01T10:00:00.000Z", "ada"),
    ).toBeNull();
  });
});
