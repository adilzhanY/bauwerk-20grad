-- Named versions (TODO Part 21, CG.2): a milestone someone names, "Survey done", "Sent to the
-- client". It points at a version of the change log; that version can be shown, compared and
-- printed. Naming copies nothing: the log already holds every version.
CREATE TABLE IF NOT EXISTS app.project_versions (
  id          uuid PRIMARY KEY,
  project_id  uuid NOT NULL REFERENCES app.projects (id) ON DELETE CASCADE,
  version     integer NOT NULL CHECK (version > 0),
  name        text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 80),
  named_by    uuid REFERENCES app.users (id) ON DELETE SET NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS project_versions_project_idx ON app.project_versions (project_id, version DESC);

ALTER TABLE app.project_versions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON app.project_versions FROM PUBLIC;
DO $do$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL ON app.project_versions FROM anon, authenticated;
  END IF;
END
$do$;
