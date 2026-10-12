import { describe, expect, it } from "vitest";
import { LINK_ROLES, ROLES, can, isRole } from "./roles";
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
    expect(LINK_ROLES.some((role) => can(role, "edit"))).toBe(false);
    expect(isRole("admin")).toBe(false);
  });
});
