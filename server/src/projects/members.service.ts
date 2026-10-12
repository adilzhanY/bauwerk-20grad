import { EventEmitter } from "node:events";
import { isUuid } from "./projects.service";
import { Inject, Injectable } from "@nestjs/common";
import type { Pool } from "pg";
import type { Role } from "@/projects/roles";
import { DB } from "../db";
import { NotificationsService } from "../notifications/notifications.service";

/** A person with access to a project, as the Share dialog and the avatars show them. */
export interface MemberInfo {
  userId: string;
  username: string;
  firstName: string;
  lastName: string;
  role: Role;
  joinedAt: string;
  /** When they last had the project open; null while they never left it or never came. */
  lastSeenAt: string | null;
  invitedBy: string | null;
}

/** Someone who asked to be let in. */
export interface AccessRequest {
  userId: string;
  username: string;
  firstName: string;
  lastName: string;
  message: string | null;
  createdAt: string;
}

/** The roles an owner can give by name; ownership moves only by `transfer`. */
export type GivenRole = Exclude<Role, "owner">;

type Outcome = "ok" | "notFound" | "already" | "owner";

interface MemberRow {
  user_id: string;
  username: string;
  first_name: string;
  last_name: string;
  role: Role;
  joined_at: Date;
  last_seen_at: Date | null;
  invited_by: string | null;
}

/**
 * Who has access to a project and with which role (TODO Part 21, CB.4 and CB.6). Every change
 * tells the person concerned (notifications) and the live sockets (`events`, "access":
 * projectId, userId, the new role or null), so a role takes effect in an open tab at once.
 * The callers check that the acting person is the owner.
 */
@Injectable()
export class MembersService {
  readonly events = new EventEmitter();

  constructor(
    @Inject(DB) private readonly pool: Pool,
    @Inject(NotificationsService) private readonly notifications: NotificationsService,
  ) {}

  async list(projectId: string): Promise<MemberInfo[]> {
    const res = await this.pool.query<MemberRow>(
      `SELECT m.user_id, u.username, u.first_name, u.last_name, m.role, m.joined_at,
              m.last_seen_at, m.invited_by
       FROM app.project_members m JOIN app.users u ON u.id = m.user_id
       WHERE m.project_id = $1
       ORDER BY (m.role = 'owner') DESC, m.joined_at`,
      [projectId],
    );
    return res.rows.map((r) => ({
      userId: r.user_id,
      username: r.username,
      firstName: r.first_name,
      lastName: r.last_name,
      role: r.role,
      joinedAt: r.joined_at.toISOString(),
      lastSeenAt: r.last_seen_at?.toISOString() ?? null,
      invitedBy: r.invited_by,
    }));
  }

  /** Invites a person by their account: they become a member at once and are told. */
  async invite(projectId: string, userId: string, role: GivenRole, by: string): Promise<Outcome> {
    const user = await this.pool.query("SELECT 1 FROM app.users WHERE id = $1", [userId]);
    if (user.rowCount === 0) return "notFound";
    const res = await this.pool.query(
      `INSERT INTO app.project_members (project_id, user_id, role, invited_by)
       VALUES ($1, $2, $3, $4) ON CONFLICT DO NOTHING`,
      [projectId, userId, role, by],
    );
    if ((res.rowCount ?? 0) === 0) return "already";
    await this.pool.query(
      "DELETE FROM app.access_requests WHERE project_id = $1 AND user_id = $2",
      [projectId, userId],
    );
    await this.forgetRemoval(projectId, userId);
    await this.notifications.notify({
      userId,
      kind: "invited",
      projectId,
      actorId: by,
      payload: { role },
    });
    this.events.emit("access", projectId, userId, role);
    return "ok";
  }

  /** Changes a member's role. The owner's own role changes only by a transfer. */
  async setRole(projectId: string, userId: string, role: GivenRole, by: string): Promise<Outcome> {
    const res = await this.pool.query(
      `UPDATE app.project_members SET role = $3
       WHERE project_id = $1 AND user_id = $2 AND role <> 'owner'`,
      [projectId, userId, role],
    );
    if ((res.rowCount ?? 0) === 0)
      return (await this.roleOf(projectId, userId)) ? "owner" : "notFound";
    await this.notifications.notify({
      userId,
      kind: "roleChanged",
      projectId,
      actorId: by,
      payload: { role },
    });
    this.events.emit("access", projectId, userId, role);
    return "ok";
  }

  /** Makes a member the owner; the owner before becomes an editor. */
  async transfer(projectId: string, userId: string, by: string): Promise<Outcome> {
    const role = await this.roleOf(projectId, userId);
    if (!role) return "notFound";
    if (role === "owner") return "already";
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(
        "UPDATE app.project_members SET role = 'editor' WHERE project_id = $1 AND role = 'owner'",
        [projectId],
      );
      await client.query(
        "UPDATE app.project_members SET role = 'owner' WHERE project_id = $1 AND user_id = $2",
        [projectId, userId],
      );
      await client.query("UPDATE app.projects SET owner_id = $2 WHERE id = $1", [
        projectId,
        userId,
      ]);
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
    await this.notifications.notify({
      userId,
      kind: "roleChanged",
      projectId,
      actorId: by,
      payload: { role: "owner" },
    });
    this.events.emit("access", projectId, userId, "owner");
    this.events.emit("access", projectId, by, "editor");
    return "ok";
  }

  /** Takes a member out (the owner removes others; anyone but the owner may leave). */
  async remove(projectId: string, userId: string, by: string): Promise<Outcome> {
    const res = await this.pool.query(
      `DELETE FROM app.project_members
       WHERE project_id = $1 AND user_id = $2 AND role <> 'owner'`,
      [projectId, userId],
    );
    if ((res.rowCount ?? 0) === 0)
      return (await this.roleOf(projectId, userId)) ? "owner" : "notFound";
    if (by !== userId) {
      // Taken out, the share link must not let them back in (it would on their next reconnect).
      await this.pool.query(
        `INSERT INTO app.project_removed (project_id, user_id) VALUES ($1, $2)
         ON CONFLICT DO NOTHING`,
        [projectId, userId],
      );
      await this.notifications.notify({ userId, kind: "removed", projectId, actorId: by });
    }
    this.events.emit("access", projectId, userId, null);
    return "ok";
  }

  /** Let in again by the owner: the share link works for them again. */
  private async forgetRemoval(projectId: string, userId: string): Promise<void> {
    await this.pool.query(
      "DELETE FROM app.project_removed WHERE project_id = $1 AND user_id = $2",
      [projectId, userId],
    );
  }

  /** When the person last had the project open, before now; null if never. */
  async lastSeen(projectId: string, userId: string): Promise<string | null> {
    const res = await this.pool.query<{ last_seen_at: Date | null }>(
      "SELECT last_seen_at FROM app.project_members WHERE project_id = $1 AND user_id = $2",
      [projectId, userId],
    );
    return res.rows[0]?.last_seen_at?.toISOString() ?? null;
  }

  /** The person's last tab of the project closed: remember when they were last in it. */
  async markSeen(projectId: string, userId: string): Promise<void> {
    await this.pool.query(
      "UPDATE app.project_members SET last_seen_at = now() WHERE project_id = $1 AND user_id = $2",
      [projectId, userId],
    );
  }

  async roleOf(projectId: string, userId: string): Promise<Role | null> {
    const res = await this.pool.query<{ role: Role }>(
      "SELECT role FROM app.project_members WHERE project_id = $1 AND user_id = $2",
      [projectId, userId],
    );
    return res.rows[0]?.role ?? null;
  }

  // Asking for access ----------------------------------------------------------------------

  /** A signed in person without access asks for it; the owner is told (once per person). */
  async request(projectId: string, userId: string, message: string | null): Promise<Outcome> {
    if (!isUuid(projectId)) return "notFound";
    const owner = await this.pool.query<{ owner_id: string | null }>(
      "SELECT owner_id FROM app.projects WHERE id = $1",
      [projectId],
    );
    const ownerId = owner.rows[0]?.owner_id;
    if (!ownerId) return "notFound";
    if (await this.roleOf(projectId, userId)) return "already";
    await this.pool.query(
      `INSERT INTO app.access_requests (project_id, user_id, message) VALUES ($1, $2, $3)
       ON CONFLICT (project_id, user_id) DO UPDATE SET message = EXCLUDED.message, created_at = now()`,
      [projectId, userId, message],
    );
    await this.notifications.notify({
      userId: ownerId,
      kind: "accessRequested",
      projectId,
      actorId: userId,
      payload: message ? { message } : {},
      groupKey: `request:${projectId}:${userId}`,
    });
    return "ok";
  }

  async requests(projectId: string): Promise<AccessRequest[]> {
    const res = await this.pool.query<{
      user_id: string;
      username: string;
      first_name: string;
      last_name: string;
      message: string | null;
      created_at: Date;
    }>(
      `SELECT r.user_id, u.username, u.first_name, u.last_name, r.message, r.created_at
       FROM app.access_requests r JOIN app.users u ON u.id = r.user_id
       WHERE r.project_id = $1 ORDER BY r.created_at`,
      [projectId],
    );
    return res.rows.map((r) => ({
      userId: r.user_id,
      username: r.username,
      firstName: r.first_name,
      lastName: r.last_name,
      message: r.message,
      createdAt: r.created_at.toISOString(),
    }));
  }

  /** Lets the person in with `role`, or declines (null). The request is gone either way. */
  async decide(
    projectId: string,
    userId: string,
    role: GivenRole | null,
    by: string,
  ): Promise<Outcome> {
    const res = await this.pool.query(
      "DELETE FROM app.access_requests WHERE project_id = $1 AND user_id = $2",
      [projectId, userId],
    );
    if ((res.rowCount ?? 0) === 0) return "notFound";
    if (!role) return "ok";
    const added = await this.pool.query(
      `INSERT INTO app.project_members (project_id, user_id, role, invited_by)
       VALUES ($1, $2, $3, $4) ON CONFLICT DO NOTHING`,
      [projectId, userId, role, by],
    );
    if ((added.rowCount ?? 0) === 0) return "already";
    await this.forgetRemoval(projectId, userId);
    await this.notifications.notify({
      userId,
      kind: "accessGranted",
      projectId,
      actorId: by,
      payload: { role },
    });
    this.events.emit("access", projectId, userId, role);
    return "ok";
  }
}
