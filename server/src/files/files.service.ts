import { EventEmitter } from "node:events";
import { randomUUID } from "node:crypto";
import { Inject, Injectable, Logger } from "@nestjs/common";
import type { OnModuleInit } from "@nestjs/common";
import type { Pool } from "pg";
import { DB } from "../db";
import type { FileStore } from "./store";

export const FILE_STORE = Symbol("FILE_STORE");

/** A file as the Files tab lists it, without its bytes. */
export interface FileRecord {
  id: string;
  slot: string | null;
  name: string;
  mime: string;
  size: number;
  width: number | null;
  height: number | null;
  uploadedBy: { id: string; firstName: string; lastName: string } | null;
  createdAt: string;
}

export interface NewFile {
  name: string;
  mime: string;
  data: Buffer;
  slot?: string | null;
  width?: number | null;
  height?: number | null;
}

/**
 * What may be uploaded: pictures, PDFs and common documents. No HTML or SVG: files are served
 * from the app's own origin, and those could carry scripts.
 */
export const FILE_TYPES = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
  "application/pdf",
  "text/plain",
  "text/csv",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  "application/zip",
] as const;

export const SLOT = /^[A-Za-z0-9_-]{1,80}$/;

interface Row {
  id: string;
  slot: string | null;
  name: string;
  mime: string;
  size: string;
  width: number | null;
  height: number | null;
  storage_key: string;
  uploaded_by: string | null;
  first_name: string | null;
  last_name: string | null;
  created_at: Date;
}

const toRecord = (r: Row): FileRecord => ({
  id: r.id,
  slot: r.slot,
  name: r.name,
  mime: r.mime,
  size: Number(r.size),
  width: r.width,
  height: r.height,
  uploadedBy:
    r.uploaded_by && r.first_name !== null
      ? { id: r.uploaded_by, firstName: r.first_name, lastName: r.last_name ?? "" }
      : null,
  createdAt: r.created_at.toISOString(),
});

/**
 * The files of every project (TODO Part 21, CD): records in Postgres, bytes in the file store.
 * Callers check access; this service only keeps files apart per project.
 */
@Injectable()
export class FilesService implements OnModuleInit {
  /** "changed" (projectId) after a file was added, replaced or removed, for open tabs. */
  readonly events = new EventEmitter();

  private readonly log = new Logger("files");

  constructor(
    @Inject(DB) private readonly pool: Pool,
    @Inject(FILE_STORE) readonly store: FileStore,
  ) {}

  async list(projectId: string): Promise<FileRecord[]> {
    const res = await this.pool.query<Row>(
      `SELECT f.id, f.slot, f.name, f.mime, f.size, f.width, f.height, f.storage_key,
              f.uploaded_by, u.first_name, u.last_name, f.created_at
       FROM app.project_files f LEFT JOIN app.users u ON u.id = f.uploaded_by
       WHERE f.project_id = $1 ORDER BY f.created_at DESC`,
      [projectId],
    );
    return res.rows.map(toRecord);
  }

  private async row(projectId: string, by: "id" | "slot", value: string): Promise<Row | null> {
    const res =
      by === "id"
        ? await this.pool.query<Row>(
            `SELECT f.id, f.slot, f.name, f.mime, f.size, f.width, f.height, f.storage_key,
                    f.uploaded_by, u.first_name, u.last_name, f.created_at
             FROM app.project_files f LEFT JOIN app.users u ON u.id = f.uploaded_by
             WHERE f.project_id = $1 AND f.id = $2`,
            [projectId, value],
          )
        : await this.pool.query<Row>(
            `SELECT f.id, f.slot, f.name, f.mime, f.size, f.width, f.height, f.storage_key,
                    f.uploaded_by, u.first_name, u.last_name, f.created_at
             FROM app.project_files f LEFT JOIN app.users u ON u.id = f.uploaded_by
             WHERE f.project_id = $1 AND f.slot = $2`,
            [projectId, value],
          );
    return res.rows[0] ?? null;
  }

  /**
   * Stores a file. With a slot it replaces the slot's file before (a facade's new photo); the
   * old bytes go once the new record is written.
   */
  async add(projectId: string, file: NewFile, by?: string): Promise<FileRecord> {
    const id = randomUUID();
    const key = `${projectId}/${id}`;
    await this.store.put(key, file.data, file.mime);
    const slot = file.slot ?? null;
    let oldKey: string | null = null;
    let written: Row | undefined;
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      if (slot) {
        // Uploads to one slot take turns: the next waits here until the one before has
        // committed, then finds and replaces its file instead of colliding on the slot.
        await client.query("SELECT pg_advisory_xact_lock(hashtext($1 || '/' || $2))", [
          projectId,
          slot,
        ]);
        const old = await client.query<{ storage_key: string }>(
          "DELETE FROM app.project_files WHERE project_id = $1 AND slot = $2 RETURNING storage_key",
          [projectId, slot],
        );
        oldKey = old.rows[0]?.storage_key ?? null;
      }
      // The record comes back from the insert itself: read again after the commit, the next
      // upload to the same slot may already have replaced it.
      const inserted = await client.query<Row>(
        `WITH f AS (
           INSERT INTO app.project_files
           (id, project_id, slot, name, mime, size, width, height, storage_key, uploaded_by)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
           RETURNING *
         )
         SELECT f.id, f.slot, f.name, f.mime, f.size, f.width, f.height, f.storage_key,
                f.uploaded_by, u.first_name, u.last_name, f.created_at
         FROM f LEFT JOIN app.users u ON u.id = f.uploaded_by`,
        [
          id,
          projectId,
          slot,
          file.name,
          file.mime,
          file.data.length,
          file.width ?? null,
          file.height ?? null,
          key,
          by ?? null,
        ],
      );
      written = inserted.rows[0];
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      await this.store.remove([key]).catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
    if (oldKey) await this.store.remove([oldKey]).catch(() => undefined);
    if (!written) throw new Error("file record not written");
    this.events.emit("changed", projectId);
    return toRecord(written);
  }

  async read(
    projectId: string,
    by: "id" | "slot",
    value: string,
  ): Promise<{ record: FileRecord; data: Buffer } | null> {
    const row = await this.row(projectId, by, value);
    if (!row) return null;
    const data = await this.store.get(row.storage_key);
    return data ? { record: toRecord(row), data } : null;
  }

  async remove(projectId: string, by: "id" | "slot", value: string): Promise<boolean> {
    const row = await this.row(projectId, by, value);
    if (!row) return false;
    await this.pool.query("DELETE FROM app.project_files WHERE id = $1", [row.id]);
    await this.store.remove([row.storage_key]).catch(() => undefined);
    this.events.emit("changed", projectId);
    return true;
  }

  /** Where a project's files lie in the store, read before the project is deleted. */
  async keysOf(projectId: string): Promise<string[]> {
    const res = await this.pool.query<{ storage_key: string }>(
      "SELECT storage_key FROM app.project_files WHERE project_id = $1",
      [projectId],
    );
    return res.rows.map((r) => r.storage_key);
  }

  /**
   * The bytes of a deleted project's files. Its rows went with the project (ON DELETE
   * CASCADE); a storage failure here leaves unused bytes behind, never half a project.
   */
  async removeBytes(keys: readonly string[]): Promise<void> {
    if (keys.length === 0) return;
    await this.store.remove([...keys]).catch((error: unknown) => {
      this.log.warn(`files left in storage after a project was deleted: ${String(error)}`);
    });
  }

  /**
   * Pictures stored before files existed (app.project_photos) move into the file store once,
   * in their slots, and leave the table; the photo routes read them from here after that.
   */
  async onModuleInit() {
    const old = await this.pool.query<{
      project_id: string;
      slot: string;
      mime: string;
      width: number;
      height: number;
      data: Buffer;
    }>("SELECT project_id, slot, mime, width, height, data FROM app.project_photos");
    for (const photo of old.rows) {
      await this.add(photo.project_id, {
        name: `${photo.slot}.${photo.mime.split("/")[1] ?? "jpg"}`,
        mime: photo.mime,
        data: photo.data,
        slot: photo.slot,
        width: photo.width,
        height: photo.height,
      });
      await this.pool.query("DELETE FROM app.project_photos WHERE project_id = $1 AND slot = $2", [
        photo.project_id,
        photo.slot,
      ]);
    }
    if (old.rows.length > 0) {
      this.log.log(`moved ${String(old.rows.length)} photos into the ${this.store.kind} store`);
    }
    // Files kept in the table while no storage was configured move into it once it is.
    if (this.store.kind !== "supabase") return;
    const kept = await this.pool.query<{ storage_key: string; data: Buffer; mime: string | null }>(
      `SELECT b.storage_key, b.data, f.mime
       FROM app.file_blobs b LEFT JOIN app.project_files f ON f.storage_key = b.storage_key`,
    );
    for (const blob of kept.rows) {
      if (blob.mime) await this.store.put(blob.storage_key, blob.data, blob.mime);
      await this.pool.query("DELETE FROM app.file_blobs WHERE storage_key = $1", [
        blob.storage_key,
      ]);
    }
    if (kept.rows.length > 0) {
      this.log.log(`moved ${String(kept.rows.length)} files from the database into storage`);
    }
  }
}
