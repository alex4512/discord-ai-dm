-- Loot and inventory kept by the bot (see docs/DECISIONS.md, D-022).
--
--   inventory         snapshot partition:
--                     { "party":      { "<key>": { "name", "qty" } },
--                       "characters": { "<character>": { "<key>": { "name", "qty", "secret" } } } }
--   inventory_events  ledger of changes since the last save, ordered on the
--                     SAME sequence as messages.seq (like xp_awards, D-014):
--                     a save folds events with seq <= boundary into
--                     `inventory`; a rollback leaves the old timeline's events
--                     behind; an undo moves the boundary back so they count
--                     again.
--
-- Current inventory = inventory partition + events on the active timeline
-- with seq > boundary_seq, applied in seq order.

ALTER TABLE public.campaign_state
  ADD COLUMN IF NOT EXISTS inventory JSONB;

ALTER TABLE public.campaign_checkpoint_versions
  ADD COLUMN IF NOT EXISTS inventory JSONB;

ALTER TABLE public.campaign_checkpoint_drafts
  ADD COLUMN IF NOT EXISTS inventory JSONB;

CREATE TABLE IF NOT EXISTS public.inventory_events (
  id          BIGSERIAL PRIMARY KEY,
  guild_id    TEXT NOT NULL,
  timeline_id UUID NOT NULL,
  seq         BIGINT NOT NULL DEFAULT nextval('public.messages_seq_seq'),
  holder      TEXT NOT NULL,              -- 'party' or a character name
  item        TEXT NOT NULL,              -- display name
  item_key    TEXT NOT NULL,              -- normalized name
  delta       INTEGER NOT NULL,           -- + gained, - lost or given away
  secret      BOOLEAN NOT NULL DEFAULT FALSE,
  reason      TEXT NOT NULL DEFAULT '',
  channel_id  TEXT NOT NULL,
  created_by  TEXT NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS inventory_events_timeline_seq_idx
  ON public.inventory_events (guild_id, timeline_id, seq);
