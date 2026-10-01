-- Working on one project together (TODO Part 21, CB and CF). Members get four roles and the
-- time they were last in the project; a project may have one share link, which grants view or
-- comment but never edit and is stored only as a hash; people without access may ask for it;
-- and every user gets an inbox of notifications.
ALTER TABLE app.project_members DROP CONSTRAINT IF EXISTS project_members_role_check;
ALTER TABLE app.project_members ADD CONSTRAINT project_members_role_check
  CHECK (role IN ('owner', 'editor', 'commenter', 'viewer'));
ALTER TABLE app.project_members ADD COLUMN IF NOT EXISTS invited_by uuid
  REFERENCES app.users (id) ON DELETE SET NULL;
ALTER TABLE app.project_members ADD COLUMN IF NOT EXISTS last_seen_at timestamptz;

CREATE TABLE IF NOT EXISTS app.project_links (
  project_id  uuid PRIMARY KEY REFERENCES app.projects (id) ON DELETE CASCADE,
  -- sha256 of the token in the address, hex. The token itself is never stored.
  token_hash  text NOT NULL CHECK (token_hash ~ '^[0-9a-f]{64}$'),
  role        text NOT NULL CHECK (role IN ('viewer', 'commenter')),
  expires_at  timestamptz,
  created_by  uuid REFERENCES app.users (id) ON DELETE SET NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS app.access_requests (
  project_id  uuid NOT NULL REFERENCES app.projects (id) ON DELETE CASCADE,
  user_id     uuid NOT NULL REFERENCES app.users (id) ON DELETE CASCADE,
  message     text CHECK (char_length(message) <= 500),
  created_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (project_id, user_id)
);

CREATE TABLE IF NOT EXISTS app.notifications (
  id          uuid PRIMARY KEY,
  user_id     uuid NOT NULL REFERENCES app.users (id) ON DELETE CASCADE,
  kind        text NOT NULL CHECK (kind ~ '^[a-zA-Z]{1,40}$'),
  project_id  uuid REFERENCES app.projects (id) ON DELETE CASCADE,
  -- Who caused it, and what the inbox shows (a thread, a role, a message). Small.
  actor_id    uuid REFERENCES app.users (id) ON DELETE SET NULL,
  payload     jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (pg_column_size(payload) <= 4000),
  -- Several replies in one thread fold into one row: its key, and how many.
  group_key   text,
  count       integer NOT NULL DEFAULT 1,
  created_at  timestamptz NOT NULL DEFAULT now(),
  read_at     timestamptz
);
CREATE INDEX IF NOT EXISTS notifications_user_idx ON app.notifications (user_id, created_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS notifications_group_idx
  ON app.notifications (user_id, group_key) WHERE group_key IS NOT NULL AND read_at IS NULL;

ALTER TABLE app.project_links ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.access_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.notifications ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON app.project_links, app.access_requests, app.notifications FROM PUBLIC;
DO $do$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL ON app.project_links, app.access_requests, app.notifications FROM anon, authenticated;
  END IF;
END
$do$;
