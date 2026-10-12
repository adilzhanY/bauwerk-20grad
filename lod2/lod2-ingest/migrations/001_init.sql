-- LoD2 Germany: core schema.
--
-- Geometry is stored in EPSG:4326 (plus a 3857 mirror for vector tiles) rather than the
-- source CRS, because the 16 states split across UTM zones 32 and 33 and a typed geometry
-- column cannot hold both. This costs nothing in accuracy: every area, volume and angle is
-- computed in the source CRS by lod2-core before it ever reaches the database.

CREATE EXTENSION IF NOT EXISTS postgis;

-- ---------------------------------------------------------------------------
-- Source tile catalogue. Populated by `lod2 index --state XX`, which downloads
-- only the state's index file and no CityGML at all. This is what lets the API
-- answer "which source tile covers this point?" for the whole country up front.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS tile_index (
  state        char(2)  NOT NULL,
  tile_id      text     NOT NULL,
  url          text     NOT NULL,
  size_bytes   bigint   NOT NULL,
  sha256       text,
  epsg         integer  NOT NULL,
  bbox         geometry(Polygon, 4326) NOT NULL,
  source_ts    timestamptz,
  indexed_at   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (state, tile_id)
);
CREATE INDEX IF NOT EXISTS tile_index_bbox_idx ON tile_index USING GIST (bbox);

-- Fetch state per tile. Kept separate from tile_index so re-indexing a state
-- (which happens on every annual data release) never clears ingest progress.
CREATE TABLE IF NOT EXISTS tile_status (
  state          char(2) NOT NULL,
  tile_id        text    NOT NULL,
  status         text    NOT NULL DEFAULT 'unfetched'
                 CHECK (status IN ('unfetched','queued','fetching','ready','empty','failed')),
  requested_at   timestamptz,
  fetched_at     timestamptz,
  building_count integer,
  bytes          bigint,
  attempts       integer NOT NULL DEFAULT 0,
  error          text,
  -- Hash/size of what we actually ingested, so a re-run can tell whether the
  -- upstream file changed. Some sources publish SHA-256, some only size+timestamp, and
  -- Berlin's feed publishes neither, hence both columns, and both nullable.
  ingested_sha256 text,
  ingested_size   bigint,
  PRIMARY KEY (state, tile_id)
);
CREATE INDEX IF NOT EXISTS tile_status_status_idx ON tile_status (state, status);

-- ---------------------------------------------------------------------------
-- Buildings.
--
-- One row per geometry-bearing feature: a standalone bldg:Building, or a
-- bldg:BuildingPart. Parents that carry only attributes and no geometry (common:
-- DENW43AL00001j37 in the fixtures is exactly this) are stored too, with
-- has_geometry = false, because they hold the function code and roof form that their
-- parts inherit.
--
-- `building_gid` is the user-facing identity: parent id for parts, own id otherwise.
-- Selecting a building in the viewer means selecting all rows sharing it.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS building (
  gid              text PRIMARY KEY,
  building_gid     text    NOT NULL,
  state            char(2) NOT NULL,
  is_part          boolean NOT NULL DEFAULT false,
  has_geometry     boolean NOT NULL DEFAULT true,
  ags              text,

  function_code    text,
  roof_type_code   text,
  measured_height  real,
  storeys_above_ground smallint,
  creation_date    date,

  -- Denormalised headline metrics: these drive map styling and filtering, so they
  -- must be columns, not JSON lookups. The full breakdown stays in `metrics`.
  footprint_area      real,
  roof_area_3d        real,
  roof_area_projected real,
  wall_area           real,
  volume              real,
  ground_z            real,
  eave_height         real,
  ridge_height        real,

  metrics    jsonb NOT NULL DEFAULT '{}'::jsonb,
  mesh       jsonb,
  flags      text[] NOT NULL DEFAULT '{}',

  ground       geometry(MultiPolygon, 4326),
  ground_3857  geometry(MultiPolygon, 3857),
  centroid     geometry(Point, 4326),

  source_tile  text,
  source_ts    timestamptz,
  ingested_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS building_ground_3857_idx ON building USING GIST (ground_3857);
CREATE INDEX IF NOT EXISTS building_centroid_idx    ON building USING GIST (centroid);
CREATE INDEX IF NOT EXISTS building_building_gid_idx ON building (building_gid);
CREATE INDEX IF NOT EXISTS building_ags_idx         ON building (ags);
CREATE INDEX IF NOT EXISTS building_state_tile_idx  ON building (state, source_tile);
CREATE INDEX IF NOT EXISTS building_metrics_idx     ON building USING GIN (metrics);
-- Partial index: map queries only ever touch rows that have a footprint.
CREATE INDEX IF NOT EXISTS building_geom_only_idx   ON building (state) WHERE has_geometry;

-- One row per planar roof face. Separate table so "every south-facing roof over
-- 30 m2 in this Gemeinde" is an index scan rather than a jsonb crawl.
CREATE TABLE IF NOT EXISTS building_roof_plane (
  gid            text    NOT NULL REFERENCES building(gid) ON DELETE CASCADE,
  idx            integer NOT NULL,
  area_3d        real    NOT NULL,
  area_projected real    NOT NULL,
  azimuth        real,          -- NULL for horizontal faces, where a bearing is meaningless
  tilt           real    NOT NULL,
  PRIMARY KEY (gid, idx)
);
CREATE INDEX IF NOT EXISTS roof_plane_azimuth_idx ON building_roof_plane (azimuth, tilt);

CREATE TABLE IF NOT EXISTS parcel (
  id            bigserial PRIMARY KEY,
  state         char(2),
  kennzeichen   text,
  geom          geometry(MultiPolygon, 4326)
);
CREATE INDEX IF NOT EXISTS parcel_geom_idx ON parcel USING GIST (geom);
