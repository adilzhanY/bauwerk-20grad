import { EventEmitter } from "node:events";
import { randomUUID } from "node:crypto";
import { Inject, Injectable } from "@nestjs/common";
import type { Pool } from "pg";
import { EXPORT_VERSION, checkBuildingShape, fromJson, validateBuilding } from "@/geometry/export";
import type { ImportError } from "@/geometry/export";
import type { Building } from "@/geometry/types";
import { applyOps } from "@/sync/ops";
import type { Op } from "@/sync/ops";
import { DB } from "../db";

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

  async list(): Promise<ProjectSummary[]> {
    const res = await this.pool.query<Row>(
      "SELECT id, name, version, updated_at FROM projects ORDER BY updated_at DESC",
    );
    return res.rows.map((r) => ({
      id: r.id,
      name: r.name,
      version: r.version,
      updatedAt: r.updated_at.toISOString(),
    }));
  }

  async get(id: string): Promise<ProjectRecord | null> {
    if (!isUuid(id)) return null;
    const res = await this.pool.query<Row>("SELECT * FROM projects WHERE id = $1", [id]);
    const row = res.rows[0];
    return row ? toRecord(row) : null;
  }

  async create(input: unknown, actor: string): Promise<WriteResult> {
    const parsed = parseBuilding(input);
    if (!parsed.ok) return { ok: false, reason: "invalid", error: parsed.error };
    const building = parsed.building;
    const id = randomUUID();
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const res = await client.query<Row>(
        "INSERT INTO projects (id, name, building, version) VALUES ($1, $2, $3, 1) RETURNING *",
        [id, building.name, JSON.stringify(building)],
      );
      await client.query(
        "INSERT INTO project_events (project_id, version, actor, patch) VALUES ($1, 1, $2, $3)",
        // The first building rides along, so any later version can be replayed from it.
        [id, actor, JSON.stringify({ type: "create", building })],
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
  async applyBatch(id: string, batch: Batch, actor: string): Promise<BatchResult> {
    if (!isUuid(id)) return { ok: false, reason: "notFound" };
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const res = await client.query<Row>("SELECT * FROM projects WHERE id = $1 FOR UPDATE", [id]);
      const row = res.rows[0];
      if (!row) {
        await client.query("ROLLBACK");
        return { ok: false, reason: "notFound" };
      }
      const seen = await client.query<{ version: number }>(
        "SELECT version FROM project_events WHERE project_id = $1 AND client_id = $2 AND seq = $3",
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
        "UPDATE projects SET building = $1, name = $2, version = $3, updated_at = now() WHERE id = $4",
        // Stored exactly as merged, not as parsed: clients replay the same operations on the
        // same value and must arrive at the same building.
        [JSON.stringify(value), value.name, version, id],
      );
      await client.query(
        `INSERT INTO project_events (project_id, version, actor, patch, client_id, seq)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [
          id,
          version,
          actor,
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
      "SELECT max(seq) AS seq FROM project_events WHERE project_id = $1 AND client_id = $2",
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
         FROM project_events WHERE project_id = $1
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
      "SELECT patch FROM project_events WHERE project_id = $1 AND version <= $2 ORDER BY version",
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

  async remove(id: string): Promise<boolean> {
    if (!isUuid(id)) return false;
    const res = await this.pool.query("DELETE FROM projects WHERE id = $1", [id]);
    return (res.rowCount ?? 0) > 0;
  }

  async eventCount(id: string): Promise<number> {
    const res = await this.pool.query<{ n: string }>(
      "SELECT count(*)::text AS n FROM project_events WHERE project_id = $1",
      [id],
    );
    return Number(res.rows[0]?.n ?? 0);
  }
}
