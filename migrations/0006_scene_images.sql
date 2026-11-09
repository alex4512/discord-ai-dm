-- Scene images (see docs/DECISIONS.md, D-008). Not game state: not
-- versioned. Rollback starts a new timeline, so arrivals reset while
-- stored images are reused.

-- Every generation, for the rolling daily limit and to see image spend.
CREATE TABLE IF NOT EXISTS public.image_generations (
  id          BIGSERIAL PRIMARY KEY,
  guild_id    TEXT NOT NULL,
  channel_id  TEXT NOT NULL,
  user_id     TEXT NOT NULL,
  trigger     TEXT NOT NULL CHECK (trigger IN ('arrival', 'request')),
  model       TEXT NOT NULL,
  size        TEXT NOT NULL,
  quality     TEXT NOT NULL,
  prompt      TEXT NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_image_generations_guild_time
  ON public.image_generations (guild_id, created_at);

-- One stored establishing image per place and audience
-- (audience_key: 'shared' | 'character:<name>' | 'dm').
CREATE TABLE IF NOT EXISTS public.scene_images (
  guild_id      TEXT NOT NULL,
  audience_key  TEXT NOT NULL,
  location_key  TEXT NOT NULL,
  prompt        TEXT NOT NULL,
  image         BYTEA NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (guild_id, audience_key, location_key)
);

-- First arrivals per timeline and audience: an arrival image is posted once.
CREATE TABLE IF NOT EXISTS public.scene_arrivals (
  guild_id      TEXT NOT NULL,
  timeline_id   UUID NOT NULL,
  audience_key  TEXT NOT NULL,
  location_key  TEXT NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (guild_id, timeline_id, audience_key, location_key)
);
