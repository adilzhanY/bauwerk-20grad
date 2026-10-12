-- The UNIQUE (project_id, version) of 001_init.sql already gives the same index; this one only
-- cost a second write on every change.
DROP INDEX IF EXISTS app.project_events_project_idx;
