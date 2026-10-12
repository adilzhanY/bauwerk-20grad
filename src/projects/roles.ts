/**
 * Who may do what in a project (TODO Part 21, CB.2). One table for the server, which enforces
 * it on every route and socket message, and for the editor, which shows only the tools a
 * person may use. Each role can do everything the roles below it can.
 *
 *   viewer     see the model, photos, files, history and threads
 *   commenter  and write in threads
 *   editor     and change the building, upload files, name versions, restore
 *   owner      and invite, change roles, set the share link, delete the project
 */
export const ROLES = ["owner", "editor", "commenter", "viewer"] as const;
export type Role = (typeof ROLES)[number];

/** What a share link may grant: never editing, an editor is always someone chosen by name. */
export const LINK_ROLES = ["viewer", "commenter"] as const;
export type LinkRole = (typeof LINK_ROLES)[number];

export type ProjectAction = "see" | "comment" | "edit" | "manage";

const RANK: Record<Role, number> = { viewer: 0, commenter: 1, editor: 2, owner: 3 };
const NEEDS: Record<ProjectAction, Role> = {
  see: "viewer",
  comment: "commenter",
  edit: "editor",
  manage: "owner",
};

export const isRole = (value: unknown): value is Role =>
  typeof value === "string" && (ROLES as readonly string[]).includes(value);

/** Whether `role` may do `action`; no role may do nothing. */
export function can(role: Role | null | undefined, action: ProjectAction): boolean {
  return role != null && RANK[role] >= RANK[NEEDS[action]];
}
