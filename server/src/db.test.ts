import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { readdirSync } from "node:fs";
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
    "DROP SCHEMA IF EXISTS app CASCADE; DROP SCHEMA IF EXISTS auth CASCADE; DROP TABLE IF EXISTS public.project_events, public.projects",
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
    const files = readdirSync(new URL("../migrations/", import.meta.url))
      .filter((f) => f.endsWith(".sql"))
      .sort();
    expect(files.length).toBeGreaterThanOrEqual(4);
    expect(done.rows.map((r) => r.name)).toEqual(files);
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

  it("on Supabase, create the profile with every sign up and refuse one without a free name", async () => {
    // A stand-in for Supabase's auth.users, with the two columns the migration uses.
    await pool.query(
      "CREATE SCHEMA auth; CREATE TABLE auth.users (id uuid PRIMARY KEY, raw_user_meta_data jsonb)",
    );
    try {
      await ensureSchema(pool);
      const signUp = (id: string, username: string | null) =>
        pool.query("INSERT INTO auth.users (id, raw_user_meta_data) VALUES ($1, $2)", [
          id,
          JSON.stringify(username === null ? {} : { username }),
        ]);
      const ada = "22222222-2222-4222-8222-222222222222";
      await signUp(ada, "Ada");
      const profile = await pool.query("SELECT username FROM app.profiles WHERE id = $1", [ada]);
      expect(profile.rows).toEqual([{ username: "Ada" }]);
      // Taken in another case, missing, or not allowed: the sign up itself fails.
      await expect(signUp("33333333-3333-4333-8333-333333333333", "ada")).rejects.toThrow();
      await expect(signUp("44444444-4444-4444-8444-444444444444", null)).rejects.toThrow();
      await expect(signUp("55555555-5555-4555-8555-555555555555", "a b")).rejects.toThrow();
      expect((await pool.query("SELECT count(*)::int AS n FROM auth.users")).rows[0]).toEqual({
        n: 1,
      });
      // A deleted account takes its profile with it.
      await pool.query("DELETE FROM auth.users WHERE id = $1", [ada]);
      expect((await pool.query("SELECT count(*)::int AS n FROM app.profiles")).rows[0]).toEqual({
        n: 0,
      });
    } finally {
      // The other test files run on a database without auth, as locally.
      await empty();
    }
  });
});
