-- Indexes and objects nothing reads. Production showed 0 scans on these indexes, and every
-- write paid for them: the GIN over `metrics` alone rewrites on each upserted building.
-- The centroid column stays (search reads it), only its spatial index goes; no query filters
-- on ags, on metrics keys, or on roof azimuth and tilt.
DROP INDEX IF EXISTS building_centroid_idx;
DROP INDEX IF EXISTS building_metrics_idx;
DROP INDEX IF EXISTS building_ags_idx;
DROP INDEX IF EXISTS roof_plane_azimuth_idx;

-- Never queried: the API sums parts itself, and no parcel data was ever loaded.
DROP VIEW IF EXISTS building_aggregate;
DROP TABLE IF EXISTS parcel;
