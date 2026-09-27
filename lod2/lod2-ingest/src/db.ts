import { readdir, readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import pg from 'pg'

export const DEFAULT_DATABASE_URL = 'postgres://lod2:lod2@localhost:55433/lod2'

export function databaseUrl(): string {
  return process.env.DATABASE_URL ?? DEFAULT_DATABASE_URL
}

export function createPool(max = 8): pg.Pool {
  return new pg.Pool({ connectionString: databaseUrl(), max })
}

/**
 * Apply every migration in order, inside one transaction per file.
 * Migrations are written to be idempotent (IF NOT EXISTS / OR REPLACE), so a bare
 * filename ledger is enough — no checksums, no down-migrations. This is an
 * experiment; the platform repo owns the grown-up version.
 */
export async function migrate(pool: pg.Pool): Promise<string[]> {
  const dir = fileURLToPath(new URL('../migrations', import.meta.url))
  const files = (await readdir(dir)).filter((f) => f.endsWith('.sql')).sort()

  await pool.query(`
    CREATE TABLE IF NOT EXISTS schema_migration (
      filename text PRIMARY KEY,
      applied_at timestamptz NOT NULL DEFAULT now()
    )`)

  const applied: string[] = []
  for (const file of files) {
    const { rows } = await pool.query('SELECT 1 FROM schema_migration WHERE filename = $1', [file])
    if (rows.length) continue
    const sql = await readFile(`${dir}/${file}`, 'utf8')
    const client = await pool.connect()
    try {
      await client.query('BEGIN')
      await client.query(sql)
      await client.query('INSERT INTO schema_migration (filename) VALUES ($1)', [file])
      await client.query('COMMIT')
      applied.push(file)
    } catch (err) {
      await client.query('ROLLBACK')
      throw new Error(`Migration ${file} failed: ${(err as Error).message}`)
    } finally {
      client.release()
    }
  }
  return applied
}

/**
 * Stable 64-bit key for pg_advisory_lock, so two processes (a CLI run and the API's
 * on-demand fetcher) never download the same tile twice.
 */
export function tileLockKey(state: string, tileId: string): bigint {
  const s = `${state}/${tileId}`
  // FNV-1a 64-bit.
  let h = 0xcbf29ce484222325n
  for (let i = 0; i < s.length; i++) {
    h ^= BigInt(s.charCodeAt(i))
    h = BigInt.asUintN(64, h * 0x100000001b3n)
  }
  // Postgres advisory locks take a signed bigint.
  return BigInt.asIntN(64, h)
}
