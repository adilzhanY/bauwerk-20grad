-- Notes become threads (TODO Part 21, CE): a thread is about one thing in the building (the
-- same targets as the notes before: the building, a wall, an opening, a room, a storey), holds
-- comments with mentions and attachments, and can be resolved. They live here and not in the
-- building, so conversation makes no versions and no undo steps.
CREATE TABLE IF NOT EXISTS app.threads (
  id           uuid PRIMARY KEY,
  project_id   uuid NOT NULL REFERENCES app.projects (id) ON DELETE CASCADE,
  target       jsonb NOT NULL CHECK (pg_column_size(target) <= 1000),
  -- The project's version when the thread was started, to show the building as it was then.
  version      integer NOT NULL,
  created_by   uuid REFERENCES app.users (id) ON DELETE SET NULL,
  created_at   timestamptz NOT NULL DEFAULT now(),
  resolved_at  timestamptz,
  resolved_by  uuid REFERENCES app.users (id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS threads_project_idx ON app.threads (project_id, created_at);

CREATE TABLE IF NOT EXISTS app.comments (
  id           uuid PRIMARY KEY,
  thread_id    uuid NOT NULL REFERENCES app.threads (id) ON DELETE CASCADE,
  author_id    uuid REFERENCES app.users (id) ON DELETE SET NULL,
  -- The name shown: the account's at the time, or the tab's name without accounts.
  author_name  text NOT NULL CHECK (char_length(author_name) BETWEEN 1 AND 120),
  text         text NOT NULL CHECK (char_length(text) BETWEEN 1 AND 5000),
  -- Files of the project attached to this comment.
  attachments  uuid[] NOT NULL DEFAULT '{}' CHECK (cardinality(attachments) <= 10),
  created_at   timestamptz NOT NULL DEFAULT now(),
  edited_at    timestamptz
);
CREATE INDEX IF NOT EXISTS comments_thread_idx ON app.comments (thread_id, created_at);

ALTER TABLE app.threads ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.comments ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON app.threads, app.comments FROM PUBLIC;
DO $do$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL ON app.threads, app.comments FROM anon, authenticated;
  END IF;
END
$do$;
