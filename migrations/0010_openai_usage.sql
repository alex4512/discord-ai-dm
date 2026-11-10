-- OpenAI usage per call, for cost logging and budget warnings (D-026).
-- Not part of the story: never versioned, never rolled back.
-- est_usd is an estimate from the price table in src/services/usage.js;
-- OpenAI's dashboard is the real bill.

CREATE TABLE IF NOT EXISTS public.openai_usage (
  id               BIGSERIAL PRIMARY KEY,
  guild_id         TEXT NOT NULL,
  kind             TEXT NOT NULL,              -- turn, campaign_checkpoint, scene_map, image_prompt, image, ...
  model            TEXT NOT NULL,
  input_tokens     INTEGER NOT NULL DEFAULT 0,
  cached_tokens    INTEGER NOT NULL DEFAULT 0,
  output_tokens    INTEGER NOT NULL DEFAULT 0,
  reasoning_tokens INTEGER NOT NULL DEFAULT 0,
  images           INTEGER NOT NULL DEFAULT 0,
  est_usd          NUMERIC(12, 6) NOT NULL DEFAULT 0,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS openai_usage_guild_time_idx
  ON public.openai_usage (guild_id, created_at);
