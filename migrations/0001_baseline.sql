-- Baseline: schema as it existed before migrations were tracked
-- (captured from the live database on 2026-11-09).
--
-- Every statement is IF NOT EXISTS, so on an existing database this is a
-- no-op that only gets recorded in schema_migrations. On an empty database
-- it creates the full schema.

CREATE TABLE IF NOT EXISTS public.messages (
  id          TEXT PRIMARY KEY,
  guild_id    TEXT NOT NULL,
  channel_id  TEXT NOT NULL,
  author_id   TEXT NOT NULL,
  role        TEXT NOT NULL CONSTRAINT messages_role_check
                CHECK (role IN ('user', 'assistant')),
  content     TEXT NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  timeline_id UUID
);

CREATE INDEX IF NOT EXISTS idx_messages_channel
  ON public.messages (guild_id, channel_id, created_at, id);

CREATE INDEX IF NOT EXISTS idx_messages_timeline
  ON public.messages (guild_id, timeline_id, created_at, id);

CREATE TABLE IF NOT EXISTS public.campaign_players (
  guild_id        TEXT NOT NULL,
  discord_user_id TEXT NOT NULL,
  character_name  TEXT NOT NULL,
  character_class TEXT,
  character_level INTEGER,
  PRIMARY KEY (guild_id, discord_user_id)
);

CREATE TABLE IF NOT EXISTS public.campaign_npcs (
  id          BIGSERIAL PRIMARY KEY,
  guild_id    TEXT NOT NULL,
  name        TEXT NOT NULL,
  location    TEXT,
  status      TEXT DEFAULT 'active',
  description TEXT,
  personality TEXT,
  knowledge   JSONB DEFAULT '[]'::jsonb,
  secrets     JSONB DEFAULT '[]'::jsonb,
  updated_at  TIMESTAMPTZ DEFAULT NOW(),
  CONSTRAINT campaign_npcs_guild_id_name_key UNIQUE (guild_id, name)
);

-- Legacy per-character checkpoints (pre-versioning).
CREATE TABLE IF NOT EXISTS public.campaign_checkpoints (
  id               BIGSERIAL PRIMARY KEY,
  guild_id         TEXT NOT NULL,
  character_name   TEXT NOT NULL,
  owner_discord_id TEXT NOT NULL,
  channel_id       TEXT NOT NULL,
  visibility       TEXT NOT NULL CONSTRAINT campaign_checkpoints_visibility_check
                     CHECK (visibility IN ('private', 'shared')),
  checkpoint       JSONB NOT NULL,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT campaign_checkpoints_guild_id_character_name_key
    UNIQUE (guild_id, character_name)
);

CREATE TABLE IF NOT EXISTS public.campaign_state (
  guild_id    TEXT PRIMARY KEY,
  checkpoint  JSONB NOT NULL DEFAULT '{}'::jsonb,
  version     INTEGER NOT NULL DEFAULT 0,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  timeline_id UUID,
  boundary_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS public.campaign_checkpoint_versions (
  id                  BIGSERIAL PRIMARY KEY,
  guild_id            TEXT NOT NULL,
  version             INTEGER NOT NULL,
  checkpoint          JSONB NOT NULL,
  created_by          TEXT NOT NULL,
  reason              TEXT NOT NULL,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  timeline_id         UUID,
  boundary_message_id TEXT,
  boundary_at         TIMESTAMPTZ,
  CONSTRAINT campaign_checkpoint_versions_guild_id_version_key
    UNIQUE (guild_id, version)
);

CREATE TABLE IF NOT EXISTS public.campaign_checkpoint_drafts (
  guild_id            TEXT PRIMARY KEY,
  checkpoint          JSONB NOT NULL,
  based_on_version    INTEGER NOT NULL,
  created_by          TEXT NOT NULL,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  timeline_id         UUID,
  boundary_message_id TEXT,
  boundary_at         TIMESTAMPTZ
);

-- Reserved for OpenAI usage/cost tracking (not written yet).
CREATE TABLE IF NOT EXISTS public.api_usage (
  response_id        TEXT PRIMARY KEY,
  guild_id           TEXT NOT NULL,
  channel_id         TEXT NOT NULL,
  model              TEXT NOT NULL,
  input_tokens       INTEGER NOT NULL,
  output_tokens      INTEGER NOT NULL,
  estimated_cost_usd NUMERIC NOT NULL,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_api_usage_month
  ON public.api_usage (created_at);
