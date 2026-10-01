-- Every file of a project in one place (TODO Part 21, CD): facade photos, floor plan images,
-- card pictures, PDFs and documents, attachments of notes. The record lives here; the bytes
-- live in Supabase Storage (bucket "projects"), or in file_blobs below where no storage is
-- configured (tests, a local database). project_photos is moved over once by the server.
CREATE TABLE IF NOT EXISTS app.project_files (
  id           uuid PRIMARY KEY,
  project_id   uuid NOT NULL REFERENCES app.projects (id) ON DELETE CASCADE,
  -- What the file is for: a facade (its edge number), "thumbnail", "model", "plan-<storey>",
  -- "note", or null for a plain document. One file per slot; a new one replaces it.
  slot         text CHECK (slot ~ '^[A-Za-z0-9_-]{1,80}$'),
  name         text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 200),
  mime         text NOT NULL CHECK (char_length(mime) <= 100),
  size         bigint NOT NULL CHECK (size > 0 AND size <= 52428800),
  width        integer CHECK (width > 0),
  height       integer CHECK (height > 0),
  storage_key  text NOT NULL UNIQUE,
  uploaded_by  uuid REFERENCES app.users (id) ON DELETE SET NULL,
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS project_files_project_idx ON app.project_files (project_id, created_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS project_files_slot_idx
  ON app.project_files (project_id, slot) WHERE slot IS NOT NULL;

CREATE TABLE IF NOT EXISTS app.file_blobs (
  storage_key  text PRIMARY KEY,
  data         bytea NOT NULL
);

ALTER TABLE app.project_files ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.file_blobs ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON app.project_files, app.file_blobs FROM PUBLIC;
DO $do$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL ON app.project_files, app.file_blobs FROM anon, authenticated;
  END IF;
END
$do$;
