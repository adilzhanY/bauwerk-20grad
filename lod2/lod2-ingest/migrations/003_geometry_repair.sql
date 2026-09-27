-- Source footprints are occasionally self-intersecting (bowtie rings from the ALKIS
-- outline). ST_MakeValid fixes them, but a silent repair is a data-quality fact worth
-- surfacing rather than swallowing, so record it per row.
ALTER TABLE building ADD COLUMN IF NOT EXISTS geometry_repaired boolean NOT NULL DEFAULT false;
CREATE INDEX IF NOT EXISTS building_repaired_idx ON building (state) WHERE geometry_repaired;
