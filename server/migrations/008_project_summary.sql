-- The Projects page lists every project with its card: title, class, end energy, stage. The
-- list read the whole building of every project and ran the energy balance for each, on every
-- visit (TODO Part 20, AC.3). Now the card is stored with the version it was made for; the
-- list reads a building only when its card is older than the project, and stores the new one.
-- Editing stays as fast as before: nothing extra is computed per batch.
ALTER TABLE app.projects ADD COLUMN IF NOT EXISTS summary jsonb;
ALTER TABLE app.projects ADD COLUMN IF NOT EXISTS summary_version integer;
CREATE INDEX IF NOT EXISTS projects_updated_idx ON app.projects (updated_at DESC);
