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

  it("on a database that had Supabase Auth, drop its trigger and ties and keep the projects", async () => {
    // A stand-in for Supabase's auth.users, with the two columns 004 used.
    await pool.query(
      "CREATE SCHEMA auth; CREATE TABLE auth.users (id uuid PRIMARY KEY, raw_user_meta_data jsonb)",
    );
    try {
      await ensureSchema(pool);
      const triggers = await pool.query(
        "SELECT 1 FROM pg_trigger WHERE tgname = 'bauwerk_create_profile'",
      );
      expect(triggers.rowCount).toBe(0);
      expect(await where("profiles")).toEqual([]);
      // Owners and members now point at app.users.
      const fks = await pool.query<{ target: string }>(
        `SELECT confrelid::regclass::text AS target FROM pg_constraint
          WHERE conname IN ('projects_owner_id_fkey', 'project_members_user_id_fkey')`,
      );
      expect(fks.rows.map((r) => r.target).sort()).toEqual(["app.users", "app.users"]);
    } finally {
      await empty();
    }
  });

  it("keep users to the rules even without the server: format, length, unique in any case", async () => {
    await ensureSchema(pool);
    const hash = "scrypt$32768$8$1$c2FsdA==$a2V5";
    const add = (username: string, first = "Ada", last = "Lovelace", h = hash) =>
      pool.query(
        "INSERT INTO app.users (username, first_name, last_name, password_hash) VALUES ($1, $2, $3, $4)",
        [username, first, last, h],
      );
    await add("ada_l");
    await expect(add("ADA_L")).rejects.toThrow(/users_username_lower_idx/);
    await expect(add("a b")).rejects.toThrow(/users_username_format/);
    await expect(add("grace", "")).rejects.toThrow(/users_first_name_length/);
    await expect(add("grace", " Grace")).rejects.toThrow(/users_first_name_length/);
    await expect(add("grace", "Grace", "x".repeat(51))).rejects.toThrow(/users_last_name_length/);
    await expect(add("grace", "Grace", "Hopper", "Plain-Password1")).rejects.toThrow(
      /users_password_hash_format/,
    );
    // A deleted user takes their own data along.
    const id = (await pool.query<{ id: string }>("SELECT id FROM app.users")).rows[0]?.id;
    await pool.query(
      "INSERT INTO app.user_bookmarks (user_id, gid) VALUES ($1, 'DEBE02YY40000BOo')",
      [id],
    );
    await pool.query("DELETE FROM app.users WHERE id = $1", [id]);
    expect((await pool.query("SELECT count(*)::int AS n FROM app.user_bookmarks")).rows[0]).toEqual(
      {
        n: 0,
      },
    );
  });
});
