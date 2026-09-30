import { EventEmitter } from "node:events";
import { randomUUID } from "node:crypto";
import { Inject, Injectable } from "@nestjs/common";
import type { Pool } from "pg";
import { EXPORT_VERSION, checkBuildingShape, fromJson, validateBuilding } from "@/geometry/export";
import type { ImportError } from "@/geometry/export";
import type { Building } from "@/geometry/types";
import { projectSummary } from "@/geometry/project";
import type { ProjectSummary as CardSummary } from "@/geometry/project";
import { applyOps } from "@/sync/ops";
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

export interface ProjectSummary {
  id: string;
  name: string;
  version: number;
  updatedAt: string;
  /** The owner's full name, with accounts on. */
  owner?: string;
  /** The id of the building inside, so a building opened from the map finds its project. */
  buildingId: string;
  /** What the Projects page shows on the card. */
  summary: CardSummary;
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

/** How many versions the history list shows at most. */
export const VERSION_LIST_LIMIT = 500;

export interface VersionEntry {
  version: number;
  actor: string;
  createdAt: string;
  kind: "create" | "ops";
  /** Operations in the batch; 0 for the creation. */
  changes: number;
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

export interface PhotoInput {
  slot: string;
  mime: string;
  width: number;
  height: number;
  data: Buffer;
}

export interface PhotoMeta {
  slot: string;
  width: number;
  height: number;
  updatedAt: string;
}

/** A stored card: the Projects page summary and the building's own id. */
type StoredCard = CardSummary & { buildingId: string };

interface ListRow {
  id: string;
  name: string;
  version: number;
  updated_at: Date;
  summary: StoredCard | null;
  building: Building | null;
  owner: string | null;
}

interface Row {
  id: string;
  name: string;
  building: Building;
  version: number;
  updated_at: Date;
}

/** Project ids are UUIDs; anything else cannot exist and must not reach Postgres as one. */
const isUuid = (id: string) =>
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
                  o.first_name || ' ' || o.last_name AS owner
             FROM app.projects p
             JOIN app.project_members m ON m.project_id = p.id AND m.user_id = $1
             LEFT JOIN app.users o ON o.id = p.owner_id
            ORDER BY p.updated_at DESC`,
          [user.id],
        )
      : await this.pool.query<ListRow>(
          `SELECT p.id, p.name, p.version, p.updated_at, p.summary,
                  CASE WHEN p.summary_version = p.version THEN NULL ELSE p.building END AS building,
                  NULL AS owner
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
        ...(r.owner ? { owner: r.owner } : {}),
      });
    }
    return out;
  }

  /**
   * May this user use the project? With accounts off, anyone may. Signed in, a member may;
   * with `join`, opening the project makes a signed in user a member first: the link is the
   * invitation, and its random id cannot be guessed.
   */
  async access(
    id: string,
    user: AuthUser | undefined,
    join: boolean,
  ): Promise<"ok" | "notFound" | "forbidden"> {
    if (!isUuid(id)) return "notFound";
    const exists = await this.pool.query("SELECT 1 FROM app.projects WHERE id = $1", [id]);
    if (exists.rowCount === 0) return "notFound";
    if (!user) return "ok";
    if (join) {
      await this.pool.query(
        `INSERT INTO app.project_members (project_id, user_id, role) VALUES ($1, $2, 'editor')
         ON CONFLICT DO NOTHING`,
        [id, user.id],
      );
      return "ok";
    }
    const member = await this.pool.query(
      "SELECT 1 FROM app.project_members WHERE project_id = $1 AND user_id = $2",
      [id, user.id],
    );
    return member.rowCount === 0 ? "forbidden" : "ok";
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
      created_at: Date;
      kind: string | null;
      changes: number;
    }>(
      `SELECT version, actor, created_at, patch->>'type' AS kind,
              COALESCE(jsonb_array_length(patch->'ops'), 0) AS changes
         FROM app.project_events WHERE project_id = $1
        ORDER BY version DESC LIMIT $2`,
      [id, VERSION_LIST_LIMIT],
    );
    return res.rows.map((r) => ({
      version: r.version,
      actor: r.actor,
      createdAt: r.created_at.toISOString(),
      kind: r.kind === "create" ? "create" : "ops",
      changes: r.changes,
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

  /** Saves (or replaces) one picture of a project. False when the project does not exist. */
  async putPhoto(id: string, photo: PhotoInput): Promise<boolean> {
    if (!isUuid(id)) return false;
    const res = await this.pool.query(
      `INSERT INTO app.project_photos (project_id, slot, mime, width, height, data)
       SELECT $1, $2, $3, $4, $5, $6 WHERE EXISTS (SELECT 1 FROM app.projects WHERE id = $1)
       ON CONFLICT (project_id, slot)
       DO UPDATE SET mime = $3, width = $4, height = $5, data = $6, updated_at = now()`,
      [id, photo.slot, photo.mime, photo.width, photo.height, photo.data],
    );
    return (res.rowCount ?? 0) > 0;
  }

  /** The pictures a project has, without their bytes. */
  async listPhotos(id: string): Promise<PhotoMeta[]> {
    if (!isUuid(id)) return [];
    const res = await this.pool.query<{
      slot: string;
      width: number;
      height: number;
      updated_at: Date;
    }>(
      "SELECT slot, width, height, updated_at FROM app.project_photos WHERE project_id = $1 ORDER BY slot",
      [id],
    );
    return res.rows.map((r) => ({
      slot: r.slot,
      width: r.width,
      height: r.height,
      updatedAt: r.updated_at.toISOString(),
    }));
  }

  async getPhoto(id: string, slot: string): Promise<{ mime: string; data: Buffer } | null> {
    if (!isUuid(id)) return null;
    const res = await this.pool.query<{ mime: string; data: Buffer }>(
      "SELECT mime, data FROM app.project_photos WHERE project_id = $1 AND slot = $2",
      [id, slot],
    );
    return res.rows[0] ?? null;
  }

  async removePhoto(id: string, slot: string): Promise<void> {
    if (!isUuid(id)) return;
    await this.pool.query("DELETE FROM app.project_photos WHERE project_id = $1 AND slot = $2", [
      id,
      slot,
    ]);
  }
}
