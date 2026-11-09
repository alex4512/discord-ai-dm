-- Experience kept by the bot (see docs/DECISIONS.md, D-014).
--
--   progress   { "<character>": { "xp": <int> } }   snapshot partition
--   xp_awards  ledger of awards since the last save, ordered on the SAME
--              sequence as messages.seq, so the checkpoint boundary covers
--              both: a save folds awards with seq <= boundary into
--              `progress`; a rollback leaves the old timeline's awards
--              behind; an undo moves the boundary back so they count again.
--
-- Current XP = progress[character].xp + SUM(awards on the active timeline
-- with seq > boundary_seq).

ALTER TABLE public.campaign_state
  ADD COLUMN IF NOT EXISTS progress JSONB;

ALTER TABLE public.campaign_checkpoint_versions
  ADD COLUMN IF NOT EXISTS progress JSONB;

ALTER TABLE public.campaign_checkpoint_drafts
  ADD COLUMN IF NOT EXISTS progress JSONB;

CREATE TABLE IF NOT EXISTS public.xp_awards (
  id              BIGSERIAL PRIMARY KEY,
  guild_id        TEXT NOT NULL,
  timeline_id     UUID NOT NULL,
  seq             BIGINT NOT NULL DEFAULT nextval('public.messages_seq_seq'),
  character_name  TEXT NOT NULL,
  amount          INTEGER NOT NULL,
  reason          TEXT NOT NULL,
  channel_id      TEXT NOT NULL,
  created_by      TEXT NOT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS xp_awards_timeline_seq_idx
  ON public.xp_awards (guild_id, timeline_id, seq);
