-- The project tables get a schema of their own, "app". On Supabase the "public" schema is
-- served by the Data API to anyone with the public key; "app" is not, and row level security
-- with no policies is a second lock. Only the server's own connection, which owns the
-- tables, reaches the rows (TODO E.3).
CREATE SCHEMA IF NOT EXISTS app;

-- Databases from before this migration have the tables in "public": move them, with their
-- rows, indexes and sequences.
DO $$
BEGIN
  IF to_regclass('public.projects') IS NOT NULL AND to_regclass('app.projects') IS NULL THEN
    ALTER TABLE public.projects SET SCHEMA app;
  END IF;
  IF to_regclass('public.project_events') IS NOT NULL AND to_regclass('app.project_events') IS NULL THEN
    ALTER TABLE public.project_events SET SCHEMA app;
  END IF;
END $$;

ALTER TABLE app.projects ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.project_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.schema_migrations ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON SCHEMA app FROM PUBLIC;

-- Supabase's API roles, where they exist (a plain local Postgres has none).
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL ON SCHEMA app FROM anon, authenticated;
    REVOKE ALL ON ALL TABLES IN SCHEMA app FROM anon, authenticated;
    ALTER DEFAULT PRIVILEGES IN SCHEMA app REVOKE ALL ON TABLES FROM anon, authenticated;
  END IF;
END $$;
