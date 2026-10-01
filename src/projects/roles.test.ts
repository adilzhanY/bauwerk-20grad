import { describe, expect, it } from "vitest";
import { ROLES, can, isLinkRole, isRole } from "./roles";
import type { ProjectAction, Role } from "./roles";

describe("roles", () => {
  it("each role can what the roles below it can, and no more", () => {
    const table: Record<Role, ProjectAction[]> = {
      owner: ["see", "comment", "edit", "manage"],
      editor: ["see", "comment", "edit"],
      commenter: ["see", "comment"],
      viewer: ["see"],
    };
    const actions: ProjectAction[] = ["see", "comment", "edit", "manage"];
    for (const role of ROLES)
      for (const action of actions) expect(can(role, action)).toBe(table[role].includes(action));
    expect(can(null, "see")).toBe(false);
  });

  it("a link never grants editing", () => {
    expect(isLinkRole("viewer") && isLinkRole("commenter")).toBe(true);
    expect(isLinkRole("editor") || isLinkRole("owner")).toBe(false);
    expect(isRole("admin")).toBe(false);
  });
});
