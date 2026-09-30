-- The pictures of a project: the straightened facade photo of each footprint edge ("0", "1",
-- ...) and the small card picture of the Projects page ("thumbnail"). Stored as bytes next to
-- the project and deleted with it.
CREATE TABLE IF NOT EXISTS app.project_photos (
  project_id  uuid NOT NULL REFERENCES app.projects (id) ON DELETE CASCADE,
  slot        text NOT NULL,
  mime        text NOT NULL,
  width       integer NOT NULL,
  height      integer NOT NULL,
  data        bytea NOT NULL,
  updated_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (project_id, slot)
);

ALTER TABLE app.project_photos ENABLE ROW LEVEL SECURITY;
