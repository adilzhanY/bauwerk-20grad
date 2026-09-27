-- Rows are written by two long-lived processes (the CLI and the API's on-demand fetcher),
-- each holding lod2-core in memory. Change a metric and restart only one of them, and the
-- database quietly accumulates two vintages of numbers that look equally plausible.
-- Stamping the version makes that visible and re-ingestable instead of silent.
ALTER TABLE building ADD COLUMN IF NOT EXISTS pipeline_version integer NOT NULL DEFAULT 0;
CREATE INDEX IF NOT EXISTS building_pipeline_version_idx ON building (pipeline_version);
