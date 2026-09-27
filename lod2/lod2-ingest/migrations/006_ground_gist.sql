-- The 4326 footprint had no spatial index -- only its 3857 mirror did, which serves the
-- vector tiles. Neighbour lookup intersects against `ground`, so without this it is a
-- sequential scan over every building in the database.
CREATE INDEX IF NOT EXISTS building_ground_idx ON building USING GIST (ground);
