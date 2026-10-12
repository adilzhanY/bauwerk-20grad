-- Deleting a project cascades to its notifications; without this index that is a full scan.
CREATE INDEX IF NOT EXISTS notifications_project_idx ON app.notifications (project_id);
