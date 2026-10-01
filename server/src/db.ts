import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath, URL } from "node:url";
import { Pool } from "pg";
import type { PoolConfig } from "pg";

export const DB = Symbol("DB");

/**
 * The connection pool. DATABASE_POOL_MAX sets its size (5 by default, well under Supabase's
 * free plan limit). DATABASE_CA_CERT, the PEM text or a path to it, verifies a database whose
 * certificate comes from its own authority, as Supabase's does (download it in the dashboard,
 * Database, SSL): the certificate is then checked against it, not skipped.
 */
export function createPool(
  connectionString = process.env.DATABASE_URL ?? "postgres://localhost/bauwerk",
): Pool {
  const config: PoolConfig = { max: Number(process.env.DATABASE_POOL_MAX ?? 5) };
  const ca = process.env.DATABASE_CA_CERT;
  if (ca) {
    // pg lets sslmode in the URL override an explicit ssl setting, so it goes from the URL.
    const url = new URL(connectionString);
    url.searchParams.delete("sslmode");
    config.connectionString = url.toString();
    config.ssl = { ca: ca.includes("BEGIN CERTIFICATE") ? ca : readFileSync(ca, "utf8") };
  } else {
    config.connectionString = connectionString;
  }
  const pool = new Pool(config);
  // An idle connection that the database or the network drops raises an error on the pool;
  // without a listener Node treats it as unhandled and the whole server stops. The pool
  // replaces the connection by itself, so it is only logged.
  pool.on("error", (error) => {
    console.error("database connection lost:", error.message);
  });
  return pool;
}

/** Any number, the same in every process: two servers starting at once migrate one by one. */
const MIGRATION_LOCK = 208_021;

/**
 * Applies the SQL files in migrations/ in name order, each once. Every file runs in its own
 * transaction together with its row in app.schema_migrations, so a failed file leaves no
 * trace and is tried again on the next start. Files from before this bookkeeping were written
 * to be safe to run again, so a database that ran them untracked is brought up to date too.
 */
export async function ensureSchema(pool: Pool): Promise<void> {
  const dir = fileURLToPath(new URL("../migrations/", import.meta.url));
  const files = readdirSync(dir)
    .filter((f) => f.endsWith(".sql"))
    .sort();
  const client = await pool.connect();
  try {
    await client.query("SELECT pg_advisory_lock($1)", [MIGRATION_LOCK]);
    await client.query(`
      CREATE SCHEMA IF NOT EXISTS app;
      CREATE TABLE IF NOT EXISTS app.schema_migrations (
        name        text PRIMARY KEY,
        applied_at  timestamptz NOT NULL DEFAULT now()
      );`);
    const done = await client.query<{ name: string }>("SELECT name FROM app.schema_migrations");
    const applied = new Set(done.rows.map((r) => r.name));
    for (const file of files) {
      if (applied.has(file)) continue;
      try {
        await client.query("BEGIN");
        await client.query(readFileSync(`${dir}${file}`, "utf8"));
        await client.query("INSERT INTO app.schema_migrations (name) VALUES ($1)", [file]);
        await client.query("COMMIT");
      } catch (error) {
        await client.query("ROLLBACK");
        throw new Error(`Migration ${file} failed: ${String(error)}`, { cause: error });
      }
    }
  } finally {
    await client.query("SELECT pg_advisory_unlock($1)", [MIGRATION_LOCK]).catch(() => undefined);
    client.release();
  }
}
