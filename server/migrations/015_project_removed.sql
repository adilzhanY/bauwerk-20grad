-- Who the owner took out of a project. A valid share link would make them a viewer again, so
-- the link refuses them until the owner invites them again or makes a new link.
CREATE TABLE IF NOT EXISTS app.project_removed (
  project_id  uuid NOT NULL REFERENCES app.projects (id) ON DELETE CASCADE,
  user_id     uuid NOT NULL REFERENCES app.users (id) ON DELETE CASCADE,
  PRIMARY KEY (project_id, user_id)
);

ALTER TABLE app.project_removed ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON app.project_removed FROM PUBLIC;
DO $do$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL ON app.project_removed FROM anon, authenticated;
  END IF;
END
$do$;
