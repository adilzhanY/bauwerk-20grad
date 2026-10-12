import { EventEmitter } from "node:events";
import { randomBytes, randomUUID } from "node:crypto";
import { Inject, Injectable } from "@nestjs/common";
import type { Pool } from "pg";
import { EXPORT_VERSION, checkBuildingShape, fromJson, validateBuilding } from "@/geometry/export";
import type { ImportError } from "@/geometry/export";
import type { Building } from "@/geometry/types";
import { projectSummary } from "@/geometry/project";
import type { ProjectSummary as CardSummary } from "@/geometry/project";
import { can, isRole } from "@/projects/roles";
import type { LinkRole, ProjectAction, Role } from "@/projects/roles";
import { applyOps } from "@/sync/ops";
import { summarizeOps } from "@/sync/summary";
import type { ChangeSummary } from "@/sync/summary";
import type { Op } from "@/sync/ops";
import { DB } from "../db";
import type { AuthUser } from "../auth/auth.service";

export interface ProjectRecord {
  id: string;
  name: string;
  building: Building;
  version: number;
  updatedAt: string;
}

/** Someone shown by name and avatar. */
export interface Person {
  id: string;
  firstName: string;
  lastName: string;
}

export interface ProjectSummary {
  id: string;
  name: string;
  version: number;
  updatedAt: string;
  /** The owner, with accounts on: for the avatar on the card. */
  owner?: Person;
  /** The id of the building inside, so a building opened from the map finds its project. */
  buildingId: string;
  /** What the Projects page shows on the card. */
  summary: CardSummary;
  /** The signed in person's role in it, and when they last had it open. */
  role?: Role;
  lastSeenAt: string | null;
  /** Who has it open right now (added by the controller from the live sockets). */
  here?: { userId: string; firstName: string; lastName: string; state: "here" | "away" }[];
}

export type WriteResult =
  { ok: true; project: ProjectRecord } | { ok: false; reason: "invalid"; error: ImportError };

/** One batch of operations from one editor tab. */
export interface Batch {
  /** Random per editor tab; with `seq` it makes a resent batch recognisable. */
  clientId: string;
  seq: number;
  ops: Op[];
  /**
   * The sender's own building passed every invariant after this batch. The editor allows
   * an invalid opening for a while (it shows it in the warning colour), so an invalid
   * result is accepted when the sender saw it too; a valid one that the merge breaks is not.
   */
  valid: boolean;
}

export type BatchResult =
  | { ok: true; version: number; duplicate: boolean; dropped: number }
  | { ok: false; reason: "invalid"; error: ImportError }
  | { ok: false; reason: "notFound" };

/** May this person do it: their role, or why not (no such project, not a member, too low a role). */
export type Access =
  { ok: true; role: Role } | { ok: false; reason: "notFound" | "notMember" | "notAllowed" };

/** A project's share link: its token (for the address), what it grants, until when. */
export interface ShareLink {
  token: string;
  role: LinkRole;
  expiresAt: string | null;
}

const LINK_TOKEN = /^[A-Za-z0-9_-]{32,64}$/;

/** How many versions the history list shows at most. */
export const VERSION_LIST_LIMIT = 500;

export interface VersionEntry {
  version: number;
  actor: string;
  createdAt: string;
  kind: "create" | "ops";
  /** Operations in the batch; 0 for the creation. */
  changes: number;
  /** The account behind it, when there are accounts. */
  actorId: string | null;
  /** What the batch did, in things: walls changed, doors added (sync/summary.ts). */
  summary: ChangeSummary;
}

/** Emitted as "ops" after every applied batch: what every client replays, in version order. */
export interface ProjectOps {
  projectId: string;
  version: number;
  actor: string;
  clientId: string;
  seq: number;
  ops: Op[];
}

/**
 * A picture's slot: a footprint edge number (its facade photo), the Projects page thumbnail,
 * the 3D view ("model"), or the floor plan a storey was read from ("plan-<storey id>").
 */
export const PHOTO_SLOT = /^(\d{1,3}|thumbnail|model|plan-[A-Za-z0-9_-]{1,64})$/;

/** A stored card: the Projects page summary and the building's own id. */
type StoredCard = CardSummary & { buildingId: string };

interface ListRow {
  id: string;
  name: string;
  version: number;
  updated_at: Date;
  summary: StoredCard | null;
  building: Building | null;
  owner_id: string | null;
  owner_first: string | null;
  owner_last: string | null;
  role: string | null;
  last_seen_at: Date | null;
}

interface Row {
  id: string;
  name: string;
  building: Building;
  version: number;
  updated_at: Date;
}

/** Ids are UUIDs; anything else cannot exist and must not reach Postgres as one (a 500). */
export const isUuid = (id: string) =>
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);

const toRecord = (r: Row): ProjectRecord => ({
  id: r.id,
  name: r.name,
  building: r.building,
  version: r.version,
  updatedAt: r.updated_at.toISOString(),
});

function parseBuilding(
  value: unknown,
): { ok: true; building: Building } | { ok: false; error: ImportError } {
  const result = fromJson(
    JSON.stringify({ format: "bauwerk", version: EXPORT_VERSION, building: value }),
  );
  return result.ok ? result : { ok: false, error: result.error };
}

@Injectable()
export class ProjectsService {
  /** Emits "ops" with a ProjectOps after every applied batch. */
  readonly events = new EventEmitter();

  constructor(@Inject(DB) private readonly pool: Pool) {}

  /**
   * The projects to offer: with accounts on, the ones this user is a member of, with the
   * owner's name; with accounts off, all of them.
   */
  async list(user?: AuthUser): Promise<ProjectSummary[]> {
    // The building comes along only for a project whose stored card is older than it.
    const res = user
      ? await this.pool.query<ListRow>(
          `SELECT p.id, p.name, p.version, p.updated_at, p.summary,
                  CASE WHEN p.summary_version = p.version THEN NULL ELSE p.building END AS building,
                  p.owner_id, o.first_name AS owner_first, o.last_name AS owner_last,
                  m.role, m.last_seen_at
             FROM app.projects p
             JOIN app.project_members m ON m.project_id = p.id AND m.user_id = $1
             LEFT JOIN app.users o ON o.id = p.owner_id
            ORDER BY p.updated_at DESC`,
          [user.id],
        )
      : await this.pool.query<ListRow>(
          `SELECT p.id, p.name, p.version, p.updated_at, p.summary,
                  CASE WHEN p.summary_version = p.version THEN NULL ELSE p.building END AS building,
                  NULL AS owner_id, NULL AS owner_first, NULL AS owner_last,
                  NULL AS role, NULL AS last_seen_at
             FROM app.projects p
            ORDER BY p.updated_at DESC`,
        );
    const out: ProjectSummary[] = [];
    for (const r of res.rows) {
      let card = r.summary;
      if (r.building) {
        card = { buildingId: r.building.id, ...projectSummary(r.building) };
        // Only if nobody changed the project meanwhile: a card never runs ahead of its version.
        await this.pool.query(
          "UPDATE app.projects SET summary = $1, summary_version = $2 WHERE id = $3 AND version = $2",
          [JSON.stringify(card), r.version, r.id],
        );
      }
      if (!card) continue;
      const { buildingId, ...summary } = card;
      out.push({
        id: r.id,
        name: r.name,
        version: r.version,
        updatedAt: r.updated_at.toISOString(),
        buildingId,
        summary,
        ...(r.owner_id && r.owner_first !== null
          ? {
              owner: { id: r.owner_id, firstName: r.owner_first, lastName: r.owner_last ?? "" },
            }
          : {}),
        ...(isRole(r.role) ? { role: r.role } : {}),
        lastSeenAt: r.last_seen_at?.toISOString() ?? null,
      });
    }
    return out;
  }

  /**
   * This person's role in the project. With accounts off everyone owns everything. Signed in,
   * a member has their role; someone who is not one gets in only with the project's share link
   * token, and then becomes a member with the link's role (view or comment, never edit). The
   * project's address alone lets nobody in.
   */
  async roleIn(id: string, user: AuthUser | undefined, linkToken?: string): Promise<Access> {
    if (!isUuid(id)) return { ok: false, reason: "notFound" };
    const exists = await this.pool.query("SELECT 1 FROM app.projects WHERE id = $1", [id]);
    if (exists.rowCount === 0) return { ok: false, reason: "notFound" };
    if (!user) return { ok: true, role: "owner" };
    const member = await this.pool.query<{ role: string }>(
      "SELECT role FROM app.project_members WHERE project_id = $1 AND user_id = $2",
      [id, user.id],
    );
    const role = member.rows[0]?.role;
    if (isRole(role)) return { ok: true, role };
    if (typeof linkToken !== "string" || !LINK_TOKEN.test(linkToken)) {
      return { ok: false, reason: "notMember" };
    }
    const link = await this.pool.query<{ role: string }>(
      `SELECT role FROM app.project_links
       WHERE project_id = $1 AND token = $2 AND (expires_at IS NULL OR expires_at > now())`,
      [id, linkToken],
    );
    const linkRole = link.rows[0]?.role;
    if (linkRole !== "viewer" && linkRole !== "commenter")
      return { ok: false, reason: "notMember" };
    await this.pool.query(
      `INSERT INTO app.project_members (project_id, user_id, role) VALUES ($1, $2, $3)
       ON CONFLICT DO NOTHING`,
      [id, user.id, linkRole],
    );
    return { ok: true, role: linkRole };
  }

  /** May this person do `action` in the project, and with which role. */
  async access(
    id: string,
    user: AuthUser | undefined,
    action: ProjectAction,
    linkToken?: string,
  ): Promise<Access> {
    const access = await this.roleIn(id, user, linkToken);
    if (!access.ok) return access;
    return can(access.role, action) ? access : { ok: false, reason: "notAllowed" };
  }

  /** The project's share link, or null when it has none. */
  async link(id: string): Promise<ShareLink | null> {
    const res = await this.pool.query<{ token: string; role: LinkRole; expires_at: Date | null }>(
      "SELECT token, role, expires_at FROM app.project_links WHERE project_id = $1",
      [id],
    );
    const row = res.rows[0];
    return row
      ? { token: row.token, role: row.role, expiresAt: row.expires_at?.toISOString() ?? null }
      : null;
  }

  /**
   * Turns the share link on or changes what it grants and until when. `reset` (or a link that
   * did not exist) makes a new token, so the old address stops working.
   */
  async setLink(
    id: string,
    settings: { role: LinkRole; expiresAt: Date | null; reset: boolean },
    by: string | undefined,
  ): Promise<ShareLink> {
    const token = randomBytes(24).toString("base64url");
    await this.pool.query(
      `INSERT INTO app.project_links (project_id, token, role, expires_at, created_by)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (project_id) DO UPDATE SET
         role = EXCLUDED.role,
         expires_at = EXCLUDED.expires_at,
         token = CASE WHEN $6 THEN EXCLUDED.token ELSE app.project_links.token END`,
      [id, token, settings.role, settings.expiresAt, by ?? null, settings.reset],
    );
    const link = await this.link(id);
    if (!link) throw new Error("share link not written");
    return link;
  }

  /** Turns the share link off: its address lets nobody in any more. */
  async removeLink(id: string): Promise<void> {
    await this.pool.query("DELETE FROM app.project_links WHERE project_id = $1", [id]);
  }

  async get(id: string): Promise<ProjectRecord | null> {
    if (!isUuid(id)) return null;
    const res = await this.pool.query<Row>("SELECT * FROM app.projects WHERE id = $1", [id]);
    const row = res.rows[0];
    return row ? toRecord(row) : null;
  }

  /** A new project from a building. Signed in, the creator owns it and is its first member. */
  async create(input: unknown, actor: string, ownerId?: string): Promise<WriteResult> {
    const parsed = parseBuilding(input);
    if (!parsed.ok) return { ok: false, reason: "invalid", error: parsed.error };
    const building = parsed.building;
    const id = randomUUID();
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const res = await client.query<Row>(
        `INSERT INTO app.projects (id, name, building, version, owner_id)
         VALUES ($1, $2, $3, 1, $4) RETURNING *`,
        [id, building.name, JSON.stringify(building), ownerId ?? null],
      );
      if (ownerId) {
        await client.query(
          "INSERT INTO app.project_members (project_id, user_id, role) VALUES ($1, $2, 'owner')",
          [id, ownerId],
        );
      }
      await client.query(
        `INSERT INTO app.project_events (project_id, version, actor, actor_id, patch)
         VALUES ($1, 1, $2, $3, $4)`,
        // The first building rides along, so any later version can be replayed from it.
        [id, actor, ownerId ?? null, JSON.stringify({ type: "create", building })],
      );
      await client.query("COMMIT");
      const row = res.rows[0];
      if (!row) throw new Error("insert returned no row");
      return { ok: true, project: toRecord(row) };
    } catch (e) {
      await client.query("ROLLBACK");
      throw e;
    } finally {
      client.release();
    }
  }

  /**
   * Applies one batch of operations from one editor tab. The project row is locked for the
   * transaction, so batches for one project apply one after another in a single order, and
   * that order is the version number every client replays. The merged building must pass
   * every invariant, otherwise nothing is written and the reason goes back to the sender.
   * A batch seen before (same client and sequence number) is acknowledged again but not
   * applied twice.
   */
  async applyBatch(
    id: string,
    batch: Batch,
    actor: string,
    actorId?: string,
  ): Promise<BatchResult> {
    if (!isUuid(id)) return { ok: false, reason: "notFound" };
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const res = await client.query<Row>("SELECT * FROM app.projects WHERE id = $1 FOR UPDATE", [
        id,
      ]);
      const row = res.rows[0];
      if (!row) {
        await client.query("ROLLBACK");
        return { ok: false, reason: "notFound" };
      }
      const seen = await client.query<{ version: number }>(
        "SELECT version FROM app.project_events WHERE project_id = $1 AND client_id = $2 AND seq = $3",
        [id, batch.clientId, batch.seq],
      );
      const earlier = seen.rows[0];
      if (earlier) {
        await client.query("ROLLBACK");
        return { ok: true, version: earlier.version, duplicate: true, dropped: 0 };
      }
      const { value, dropped } = applyOps(row.building, batch.ops);
      const error =
        checkBuildingShape(value, "building") ?? (batch.valid ? validateBuilding(value) : null);
      if (error) {
        await client.query("ROLLBACK");
        return { ok: false, reason: "invalid", error };
      }
      const applied = batch.ops.filter((op) => !dropped.includes(op));
      const version = row.version + 1;
      await client.query(
        "UPDATE app.projects SET building = $1, name = $2, version = $3, updated_at = now() WHERE id = $4",
        // Stored exactly as merged, not as parsed: clients replay the same operations on the
        // same value and must arrive at the same building.
        [JSON.stringify(value), value.name, version, id],
      );
      await client.query(
        `INSERT INTO app.project_events (project_id, version, actor, actor_id, patch, client_id, seq)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [
          id,
          version,
          actor,
          actorId ?? null,
          JSON.stringify({ type: "ops", ops: applied }),
          batch.clientId,
          batch.seq,
        ],
      );
      await client.query("COMMIT");
      this.events.emit("ops", {
        projectId: id,
        version,
        actor,
        clientId: batch.clientId,
        seq: batch.seq,
        ops: applied,
      } satisfies ProjectOps);
      return { ok: true, version, duplicate: false, dropped: dropped.length };
    } catch (e) {
      await client.query("ROLLBACK");
      throw e;
    } finally {
      client.release();
    }
  }

  /** The highest sequence number of `clientId` this project has applied, or 0. */
  async lastSeq(id: string, clientId: string): Promise<number> {
    if (!isUuid(id)) return 0;
    const res = await this.pool.query<{ seq: number | null }>(
      "SELECT max(seq) AS seq FROM app.project_events WHERE project_id = $1 AND client_id = $2",
      [id, clientId],
    );
    return res.rows[0]?.seq ?? 0;
  }

  /** Every version, newest first: who made it, when, and how many changes it carried. */
  async versions(id: string): Promise<VersionEntry[] | null> {
    if (!(await this.get(id))) return null;
    const res = await this.pool.query<{
      version: number;
      actor: string;
      actor_id: string | null;
      created_at: Date;
      kind: string | null;
      ops: Op[] | null;
    }>(
      `SELECT version, actor, actor_id, created_at, patch->>'type' AS kind, patch->'ops' AS ops
         FROM app.project_events WHERE project_id = $1
        ORDER BY version DESC LIMIT $2`,
      [id, VERSION_LIST_LIMIT],
    );
    return res.rows.map((r) => ({
      version: r.version,
      actor: r.actor,
      actorId: r.actor_id,
      createdAt: r.created_at.toISOString(),
      kind: r.kind === "create" ? "create" : "ops",
      changes: r.ops?.length ?? 0,
      summary: r.ops ? summarizeOps(r.ops) : {},
    }));
  }

  /**
   * The building as it was at `version`: the created building, with every batch after it
   * replayed in order. Projects from before batches existed kept no replayable history.
   */
  async buildingAt(
    id: string,
    version: number,
  ): Promise<
    { ok: true; building: Building } | { ok: false; reason: "notFound" | "notReplayable" }
  > {
    const current = await this.get(id);
    if (!current || version < 1 || version > current.version)
      return { ok: false, reason: "notFound" };
    if (version === current.version) return { ok: true, building: current.building };
    const res = await this.pool.query<{
      patch: { type?: string; building?: Building; ops?: Op[] };
    }>(
      "SELECT patch FROM app.project_events WHERE project_id = $1 AND version <= $2 ORDER BY version",
      [id, version],
    );
    let building: Building | null = null;
    for (const { patch } of res.rows) {
      if (patch.type === "create" && patch.building) building = patch.building;
      else if (patch.type === "ops" && patch.ops && building)
        building = applyOps(building, patch.ops).value;
      else building = null;
    }
    return building ? { ok: true, building } : { ok: false, reason: "notReplayable" };
  }

  /** Deletes a project. Signed in, only its owner may. */
  async remove(id: string, user?: AuthUser): Promise<"ok" | "notFound" | "forbidden"> {
    if (!isUuid(id)) return "notFound";
    const res = user
      ? await this.pool.query("DELETE FROM app.projects WHERE id = $1 AND owner_id = $2", [
          id,
          user.id,
        ])
      : await this.pool.query("DELETE FROM app.projects WHERE id = $1", [id]);
    if ((res.rowCount ?? 0) > 0) return "ok";
    return (await this.get(id)) ? "forbidden" : "notFound";
  }

  async eventCount(id: string): Promise<number> {
    const res = await this.pool.query<{ n: string }>(
      "SELECT count(*)::text AS n FROM app.project_events WHERE project_id = $1",
      [id],
    );
    return Number(res.rows[0]?.n ?? 0);
  }
}
