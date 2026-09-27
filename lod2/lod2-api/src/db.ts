/**
 * Postgres pools for the API.
 *
 * Two pools, because they need different limits. Request handlers get a statement timeout
 * so one slow query cannot hold a connection forever. On-demand ingestion runs long bulk
 * loads inside loadTile, which a 15 s statement timeout would cut off, so it has its own
 * small pool without one.
 */
import { readdir } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import pg from 'pg'
import { databaseUrl } from 'lod2-ingest/db'

const CONNECTION_TIMEOUT_MS = 5_000
const STATEMENT_TIMEOUT_MS = 15_000

export function createRequestPool(max: number): pg.Pool {
  const pool = new pg.Pool({
    connectionString: databaseUrl(),
    max,
    connectionTimeoutMillis: CONNECTION_TIMEOUT_MS,
    statement_timeout: STATEMENT_TIMEOUT_MS,
  })
  logPoolErrors(pool, 'request')
  return pool
}

export function createIngestPool(max: number): pg.Pool {
  const pool = new pg.Pool({
    connectionString: databaseUrl(),
    max,
    connectionTimeoutMillis: CONNECTION_TIMEOUT_MS,
  })
  logPoolErrors(pool, 'ingest')
  return pool
}

/** An idle client losing its connection emits 'error' on the pool; unhandled, it kills the process. */
function logPoolErrors(pool: pg.Pool, name: string): void {
  pool.on('error', (err) => {
    console.warn(`${name} pool: idle client error: ${err.message}`)
  })
}

/** Filename of the newest migration shipped with lod2-ingest. */
export async function latestMigration(): Promise<string | null> {
  const dir = fileURLToPath(new URL('../migrations/', import.meta.resolve('lod2-ingest/db')))
  const files = (await readdir(dir)).filter((f) => f.endsWith('.sql')).sort()
  return files.at(-1) ?? null
}

export type DbHealth =
  | { ok: true; migration: string | null }
  | { ok: false; error: string }

/** Postgres answers, and the newest migration is recorded in the ledger. */
export async function checkDatabase(pool: pg.Pool): Promise<DbHealth> {
  try {
    await pool.query('SELECT 1')
  } catch (err) {
    return { ok: false, error: `database unreachable: ${(err as Error).message}` }
  }

  const migration = await latestMigration()
  if (!migration) return { ok: true, migration: null }
  try {
    const { rows } = await pool.query('SELECT 1 FROM schema_migration WHERE filename = $1', [migration])
    if (rows.length === 0) return { ok: false, error: `database not migrated: ${migration} is missing` }
  } catch (err) {
    return { ok: false, error: `database not migrated: ${(err as Error).message}` }
  }
  return { ok: true, migration }
}
