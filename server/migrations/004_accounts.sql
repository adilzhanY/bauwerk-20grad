-- Accounts (TODO sections F and G). Profiles carry the username others see; projects get an
-- owner and members. On Supabase they are tied to auth.users, and every sign up creates its
-- profile. A plain local Postgres has no auth schema: the tables exist there without those
-- ties, and accounts stay off (no SUPABASE_URL).
CREATE TABLE IF NOT EXISTS app.profiles (
  id          uuid PRIMARY KEY,
  username    text NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT profiles_username_format CHECK (username ~ '^[A-Za-z0-9_-]{3,24}$')
);
-- "Ada" and "ada" are one name.
CREATE UNIQUE INDEX IF NOT EXISTS profiles_username_lower_idx ON app.profiles (lower(username));

ALTER TABLE app.projects ADD COLUMN IF NOT EXISTS owner_id uuid;
ALTER TABLE app.project_events ADD COLUMN IF NOT EXISTS actor_id uuid;

CREATE TABLE IF NOT EXISTS app.project_members (
  project_id  uuid NOT NULL REFERENCES app.projects(id) ON DELETE CASCADE,
  user_id     uuid NOT NULL,
  role        text NOT NULL CHECK (role IN ('owner', 'editor')),
  joined_at   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (project_id, user_id)
);
CREATE INDEX IF NOT EXISTS project_members_user_idx ON app.project_members (user_id);

ALTER TABLE app.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.project_members ENABLE ROW LEVEL SECURITY;

DO $do$
BEGIN
  IF to_regclass('auth.users') IS NULL THEN
    RETURN;
  END IF;
  -- A deleted account takes its profile, its memberships and its own projects with it.
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'profiles_id_fkey') THEN
    ALTER TABLE app.profiles ADD CONSTRAINT profiles_id_fkey
      FOREIGN KEY (id) REFERENCES auth.users(id) ON DELETE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'projects_owner_id_fkey') THEN
    ALTER TABLE app.projects ADD CONSTRAINT projects_owner_id_fkey
      FOREIGN KEY (owner_id) REFERENCES auth.users(id) ON DELETE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'project_members_user_id_fkey') THEN
    ALTER TABLE app.project_members ADD CONSTRAINT project_members_user_id_fkey
      FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
  END IF;

  -- Every sign up creates its profile from the username the client passed. A missing or
  -- invalid one, or one already taken, fails the sign up itself: no account without a name.
  CREATE OR REPLACE FUNCTION app.create_profile() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $fn$
  BEGIN
    INSERT INTO app.profiles (id, username) VALUES (NEW.id, NEW.raw_user_meta_data ->> 'username');
    RETURN NEW;
  END
  $fn$;
  REVOKE ALL ON FUNCTION app.create_profile() FROM PUBLIC;
  DROP TRIGGER IF EXISTS bauwerk_create_profile ON auth.users;
  CREATE TRIGGER bauwerk_create_profile AFTER INSERT ON auth.users
    FOR EACH ROW EXECUTE FUNCTION app.create_profile();
END
$do$;
