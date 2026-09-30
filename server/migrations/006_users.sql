-- Accounts of our own (TODO Part 20). Supabase Auth wants an email for every account; Bauwerk
-- signs in with a username and a password, so the users live here and the server checks the
-- passwords. Supabase is only the Postgres database.
--
-- The checks repeat the rules of src/auth/schema.ts, so no row can break them even if
-- something ever wrote here without the server's parsing.
CREATE TABLE IF NOT EXISTS app.users (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  username       text NOT NULL,
  first_name     text NOT NULL,
  last_name      text NOT NULL,
  password_hash  text NOT NULL,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT users_username_format CHECK (username ~ '^[A-Za-z0-9_-]{3,24}$'),
  CONSTRAINT users_first_name_length
    CHECK (first_name = btrim(first_name) AND char_length(first_name) BETWEEN 1 AND 50),
  CONSTRAINT users_last_name_length
    CHECK (last_name = btrim(last_name) AND char_length(last_name) BETWEEN 1 AND 50),
  -- Only a hash in our own format, never a password.
  CONSTRAINT users_password_hash_format CHECK (password_hash ~ '^scrypt\$[0-9]+\$[0-9]+\$[0-9]+\$')
);
-- "Ada" and "ada" are one name.
CREATE UNIQUE INDEX IF NOT EXISTS users_username_lower_idx ON app.users (lower(username));

-- The Supabase Auth pieces of 004 go: the trigger on auth.users, its function, the ties to
-- auth.users, and the profiles, which only existed for accounts made there.
DO $do$
BEGIN
  IF to_regclass('auth.users') IS NOT NULL THEN
    DROP TRIGGER IF EXISTS bauwerk_create_profile ON auth.users;
  END IF;
END
$do$;
DROP FUNCTION IF EXISTS app.create_profile();
ALTER TABLE app.projects DROP CONSTRAINT IF EXISTS projects_owner_id_fkey;
ALTER TABLE app.project_members DROP CONSTRAINT IF EXISTS project_members_user_id_fkey;
DROP TABLE IF EXISTS app.profiles;

-- Owners and members are our users now. Rows of accounts that no longer exist cannot point
-- anywhere: memberships go, projects keep their rows without an owner.
DELETE FROM app.project_members m WHERE NOT EXISTS (SELECT 1 FROM app.users u WHERE u.id = m.user_id);
UPDATE app.projects p SET owner_id = NULL
  WHERE owner_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM app.users u WHERE u.id = p.owner_id);

-- A deleted account takes its memberships and its own projects with it (as in 004).
ALTER TABLE app.projects ADD CONSTRAINT projects_owner_id_fkey
  FOREIGN KEY (owner_id) REFERENCES app.users (id) ON DELETE CASCADE;
ALTER TABLE app.project_members ADD CONSTRAINT project_members_user_id_fkey
  FOREIGN KEY (user_id) REFERENCES app.users (id) ON DELETE CASCADE;
-- The history keeps the actor's id and name after the account is gone: no foreign key there.
CREATE INDEX IF NOT EXISTS projects_owner_idx ON app.projects (owner_id);

ALTER TABLE app.users ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON app.users FROM PUBLIC;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL ON app.users FROM anon, authenticated;
  END IF;
END $$;
