-- Edits arrive as batches of operations. Each batch carries the id of the editor tab that
-- sent it and its sequence number there, so a batch resent after a reconnect is applied
-- once only.
ALTER TABLE project_events ADD COLUMN IF NOT EXISTS client_id text;
ALTER TABLE project_events ADD COLUMN IF NOT EXISTS seq integer;

CREATE UNIQUE INDEX IF NOT EXISTS project_events_client_seq_idx
  ON project_events (project_id, client_id, seq)
  WHERE client_id IS NOT NULL;
