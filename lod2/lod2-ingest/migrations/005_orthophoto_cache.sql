-- Cached DOP crops.
--
-- These come from the same public authority servers as the CityGML, so the same rule
-- applies: fetch once, reuse. Without this, every time a user re-selects a building we
-- would issue a fresh GetMap against gdi.berlin.de.
--
-- Keyed by a hash of the full request (state, layer, bbox, pixel size) so a changed bbox
-- is a different entry rather than a silent mismatch between image and UV mapping.
CREATE TABLE IF NOT EXISTS orthophoto_cache (
  key          text PRIMARY KEY,
  state        char(2) NOT NULL,
  layer        text    NOT NULL,
  epsg         integer NOT NULL,
  min_x        double precision NOT NULL,
  min_y        double precision NOT NULL,
  max_x        double precision NOT NULL,
  max_y        double precision NOT NULL,
  width_px     integer NOT NULL,
  height_px    integer NOT NULL,
  content_type text    NOT NULL,
  image        bytea   NOT NULL,
  bytes        integer NOT NULL,
  fetched_at   timestamptz NOT NULL DEFAULT now(),
  hits         integer NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS orthophoto_cache_fetched_idx ON orthophoto_cache (fetched_at);
CREATE INDEX IF NOT EXISTS orthophoto_cache_state_idx ON orthophoto_cache (state);
