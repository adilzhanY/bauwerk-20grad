-- Aggregate view: metrics for a whole ALKIS building, summing across its parts.
-- A parent with no geometry contributes nothing but keeps its attributes visible.
CREATE OR REPLACE VIEW building_aggregate AS
SELECT
  b.building_gid,
  min(b.state)                                    AS state,
  max(b.ags)                                      AS ags,
  -- Attributes live on the parent when parts exist, so coalesce across the group.
  max(b.function_code)  FILTER (WHERE b.function_code IS NOT NULL)  AS function_code,
  max(b.roof_type_code) FILTER (WHERE b.roof_type_code IS NOT NULL) AS roof_type_code,
  count(*)                                        AS part_count,
  count(*) FILTER (WHERE b.has_geometry)          AS geometry_part_count,
  sum(b.footprint_area)                           AS footprint_area,
  sum(b.roof_area_3d)                             AS roof_area_3d,
  sum(b.roof_area_projected)                      AS roof_area_projected,
  sum(b.wall_area)                                AS wall_area,
  sum(b.volume)                                   AS volume,
  min(b.ground_z)                                 AS ground_z,
  max(b.ridge_height)                             AS ridge_height,
  min(b.eave_height)                              AS eave_height,
  -- array_agg over a set-returning unnest would multiply rows; aggregate distinctly.
  (SELECT array_agg(DISTINCT f) FROM building b2, unnest(b2.flags) f
     WHERE b2.building_gid = b.building_gid)      AS flags,
  ST_Multi(ST_Union(b.ground))                    AS ground,
  ST_Centroid(ST_Union(b.ground))                 AS centroid
FROM building b
GROUP BY b.building_gid;
