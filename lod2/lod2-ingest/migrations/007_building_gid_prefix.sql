-- Prefix search on building ids (`building_gid LIKE 'DEBE01%'`).
-- The plain btree from 001 only serves LIKE in the C collation; text_pattern_ops serves it
-- in any collation. Metric columns stay `real`: the building_aggregate view depends on them,
-- and the status command sums them as float8 instead.
CREATE INDEX IF NOT EXISTS building_building_gid_prefix_idx
  ON building (building_gid text_pattern_ops);
