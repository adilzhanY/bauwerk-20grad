import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { Pool } from "pg";
import { ensureSchema } from "./db";

const url = process.env.DATABASE_URL ?? "postgres://bauwerk@127.0.0.1:5499/bauwerk_test";
const pool = new Pool({ connectionString: url });

afterAll(async () => {
  await pool.end();
});

/** Starts from an empty database: no app schema, no old public tables. */
async function empty() {
  await pool.query(
    "DROP SCHEMA IF EXISTS app CASCADE; DROP TABLE IF EXISTS public.project_events, public.projects",
  );
}

const where = async (table: string) =>
  (
    await pool.query<{ schema: string }>(
      "SELECT table_schema AS schema FROM information_schema.tables WHERE table_name = $1",
      [table],
    )
  ).rows.map((r) => r.schema);

describe("migrations", () => {
  beforeEach(empty);

  it("run each file once, even when the server starts twice", async () => {
    await ensureSchema(pool);
    await ensureSchema(pool);
    const done = await pool.query<{ name: string }>(
      "SELECT name FROM app.schema_migrations ORDER BY name",
    );
    expect(done.rows.map((r) => r.name)).toEqual([
      "001_init.sql",
      "002_ops.sql",
      "003_app_schema.sql",
    ]);
    expect(await where("projects")).toEqual(["app"]);
    expect(await where("project_events")).toEqual(["app"]);
  });

  it("move a database from before the app schema, and keep its projects", async () => {
    // The old runner ran 001 and 002 into public without recording them.
    await pool.query(`
      CREATE TABLE public.projects (id uuid PRIMARY KEY, name text NOT NULL, building jsonb NOT NULL,
        version integer NOT NULL DEFAULT 1, updated_at timestamptz NOT NULL DEFAULT now());
      CREATE TABLE public.project_events (id bigserial PRIMARY KEY,
        project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
        version integer NOT NULL, actor text NOT NULL, patch jsonb NOT NULL,
        created_at timestamptz NOT NULL DEFAULT now(), UNIQUE (project_id, version));
      INSERT INTO public.projects (id, name, building) VALUES
        ('11111111-1111-4111-8111-111111111111', 'Kept', '{}');
      INSERT INTO public.project_events (project_id, version, actor, patch) VALUES
        ('11111111-1111-4111-8111-111111111111', 1, 'a', '{}');`);
    await ensureSchema(pool);
    await ensureSchema(pool);
    expect(await where("projects")).toEqual(["app"]);
    const kept = await pool.query("SELECT name FROM app.projects");
    expect(kept.rows).toEqual([{ name: "Kept" }]);
    // The event id sequence moved with its table and still counts on.
    await pool.query(
      "INSERT INTO app.project_events (project_id, version, actor, patch) VALUES ('11111111-1111-4111-8111-111111111111', 2, 'a', '{}')",
    );
    expect((await pool.query("SELECT count(*)::int AS n FROM app.project_events")).rows[0]).toEqual(
      { n: 2 },
    );
  });

  it("turn on row level security on every table in app", async () => {
    await ensureSchema(pool);
    const tables = await pool.query<{ relname: string; relrowsecurity: boolean }>(
      `SELECT c.relname, c.relrowsecurity FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'app' AND c.relkind = 'r' ORDER BY c.relname`,
    );
    expect(tables.rows.length).toBeGreaterThanOrEqual(3);
    expect(tables.rows.every((t) => t.relrowsecurity)).toBe(true);
  });
});
