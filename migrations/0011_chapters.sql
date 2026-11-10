-- Chapter summaries of old chronicle events (see docs/DECISIONS.md, D-033).
--
--   chapters  snapshot partition:
--             { "through": <n>,   -- chronicle entries [0, n) are covered by chapters
--               "list": [ { "title", "summary", "known_by": [...], "from", "to" } ] }
--             from/to are chronicle indexes (first and last event of the chapter).
--             Each chapter covers events with exactly one known_by set, so a
--             chapter never mixes what different characters know.
--
-- Play turns show the chapters plus the chronicle from `through` on. The
-- chronicle itself is never shortened: /story and /chronicle all still read
-- every event.

ALTER TABLE public.campaign_state
  ADD COLUMN IF NOT EXISTS chapters JSONB;

ALTER TABLE public.campaign_checkpoint_versions
  ADD COLUMN IF NOT EXISTS chapters JSONB;

ALTER TABLE public.campaign_checkpoint_drafts
  ADD COLUMN IF NOT EXISTS chapters JSONB;
