-- What a user keeps that is not a project (TODO Part 20, AC.2). Until now it lived only in one
-- browser's storage and was lost on another device: the settings, the bookmarked buildings,
-- and per LoD2 building a free note and the facade survey (the openings measured on each
-- photographed wall, the age class, the storey count). Everything goes with the account.
CREATE TABLE IF NOT EXISTS app.user_settings (
  user_id        uuid PRIMARY KEY REFERENCES app.users (id) ON DELETE CASCADE,
  language       text CHECK (language IN ('en', 'de')),
  theme          text CHECK (theme IN ('light', 'dark', 'system')),
  projects_view  text CHECK (projects_view IN ('grid', 'list', 'map')),
  updated_at     timestamptz NOT NULL DEFAULT now()
);

-- A building is its Gebäude-ID from the LoD2 data, e.g. DEBE02YY40000BOo.
CREATE TABLE IF NOT EXISTS app.user_bookmarks (
  user_id     uuid NOT NULL REFERENCES app.users (id) ON DELETE CASCADE,
  gid         text NOT NULL CHECK (gid ~ '^[A-Za-z0-9._-]{1,64}$'),
  created_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, gid)
);

CREATE TABLE IF NOT EXISTS app.user_buildings (
  user_id     uuid NOT NULL REFERENCES app.users (id) ON DELETE CASCADE,
  gid         text NOT NULL CHECK (gid ~ '^[A-Za-z0-9._-]{1,64}$'),
  note        text CHECK (char_length(note) <= 20000),
  survey      jsonb CHECK (survey IS NULL OR jsonb_typeof(survey) = 'object'),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, gid),
  -- A row with neither is deleted instead.
  CONSTRAINT user_buildings_not_empty CHECK (note IS NOT NULL OR survey IS NOT NULL)
);

ALTER TABLE app.user_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.user_bookmarks ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.user_buildings ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON app.user_settings, app.user_bookmarks, app.user_buildings FROM PUBLIC;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL ON app.user_settings, app.user_bookmarks, app.user_buildings FROM anon, authenticated;
  END IF;
END $$;
