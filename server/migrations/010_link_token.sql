-- The share link keeps its token, not only a hash (TODO Part 21, CB.5): the owner copies the
-- link whenever they want, as in Figma and Google Docs, and a link grants at most view or
-- comment. Only the owner's route reads it; reset replaces it. 009's table had no rows yet.
DROP TABLE IF EXISTS app.project_links;
CREATE TABLE app.project_links (
  project_id  uuid PRIMARY KEY REFERENCES app.projects (id) ON DELETE CASCADE,
  token       text NOT NULL UNIQUE CHECK (token ~ '^[A-Za-z0-9_-]{32,64}$'),
  role        text NOT NULL CHECK (role IN ('viewer', 'commenter')),
  expires_at  timestamptz,
  created_by  uuid REFERENCES app.users (id) ON DELETE SET NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE app.project_links ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON app.project_links FROM PUBLIC;
DO $do$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL ON app.project_links FROM anon, authenticated;
  END IF;
END
$do$;
