import type { Pool } from "pg";

/** Where the bytes of project files live; the records are in app.project_files either way. */
export interface FileStore {
  readonly kind: "supabase" | "database";
  put(key: string, data: Buffer, mime: string): Promise<void>;
  get(key: string): Promise<Buffer | null>;
  remove(keys: readonly string[]): Promise<void>;
}

export const BUCKET = "projects";
/** Supabase's free plan allows 50 MB per file; the table allows the same. */
export const MAX_FILE_BYTES = 52_428_800;

/**
 * Supabase Storage through its REST API, with the project's secret key, from this server
 * only: the bucket is private, and the browser never talks to Supabase.
 */
export class SupabaseStore implements FileStore {
  readonly kind = "supabase";
  private ready: Promise<void> | null = null;

  constructor(
    private readonly url: string,
    private readonly key: string,
  ) {}

  private headers(extra: Record<string, string> = {}) {
    return { apikey: this.key, authorization: `Bearer ${this.key}`, ...extra };
  }

  private object(key: string) {
    return `${this.url}/storage/v1/object/${BUCKET}/${key.split("/").map(encodeURIComponent).join("/")}`;
  }

  /** Makes the private bucket on first use when it does not exist yet. */
  private bucket(): Promise<void> {
    this.ready ??= (async () => {
      const found = await fetch(`${this.url}/storage/v1/bucket/${BUCKET}`, {
        headers: this.headers(),
      });
      if (found.ok) return;
      const made = await fetch(`${this.url}/storage/v1/bucket`, {
        method: "POST",
        headers: this.headers({ "content-type": "application/json" }),
        body: JSON.stringify({
          id: BUCKET,
          name: BUCKET,
          public: false,
          file_size_limit: MAX_FILE_BYTES,
        }),
      });
      if (!made.ok && made.status !== 409) {
        throw new Error(`storage bucket: ${String(made.status)} ${await made.text()}`);
      }
    })().catch((error: unknown) => {
      // Any failure, a refused request or a network error, is tried again on the next use.
      this.ready = null;
      throw error;
    });
    return this.ready;
  }

  async put(key: string, data: Buffer, mime: string) {
    await this.bucket();
    const res = await fetch(this.object(key), {
      method: "POST",
      headers: this.headers({ "content-type": mime, "x-upsert": "true" }),
      body: new Uint8Array(data),
    });
    if (!res.ok) throw new Error(`storage put: ${String(res.status)} ${await res.text()}`);
  }

  async get(key: string) {
    await this.bucket();
    const res = await fetch(this.object(key), { headers: this.headers() });
    if (res.status === 404 || res.status === 400) return null;
    if (!res.ok) throw new Error(`storage get: ${String(res.status)}`);
    return Buffer.from(await res.arrayBuffer());
  }

  async remove(keys: readonly string[]) {
    if (keys.length === 0) return;
    await this.bucket();
    const res = await fetch(`${this.url}/storage/v1/object/${BUCKET}`, {
      method: "DELETE",
      headers: this.headers({ "content-type": "application/json" }),
      body: JSON.stringify({ prefixes: keys }),
    });
    if (!res.ok) throw new Error(`storage remove: ${String(res.status)}`);
  }
}

/** The bytes in a table, where no storage is configured: tests and a local database. */
export class DatabaseStore implements FileStore {
  readonly kind = "database";

  constructor(private readonly pool: Pool) {}

  async put(key: string, data: Buffer) {
    await this.pool.query(
      `INSERT INTO app.file_blobs (storage_key, data) VALUES ($1, $2)
       ON CONFLICT (storage_key) DO UPDATE SET data = EXCLUDED.data`,
      [key, data],
    );
  }

  async get(key: string) {
    const res = await this.pool.query<{ data: Buffer }>(
      "SELECT data FROM app.file_blobs WHERE storage_key = $1",
      [key],
    );
    return res.rows[0]?.data ?? null;
  }

  async remove(keys: readonly string[]) {
    if (keys.length === 0) return;
    await this.pool.query("DELETE FROM app.file_blobs WHERE storage_key = ANY($1::text[])", [keys]);
  }
}

/** Supabase Storage when SUPABASE_URL and SUPABASE_SECRET_KEY are set, else the table. */
export function fileStoreFromEnv(pool: Pool, env = process.env): FileStore {
  const url = env.SUPABASE_URL?.replace(/\/$/, "");
  const key = env.SUPABASE_SECRET_KEY;
  return url && key ? new SupabaseStore(url, key) : new DatabaseStore(pool);
}
