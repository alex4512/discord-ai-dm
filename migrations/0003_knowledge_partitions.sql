-- Knowledge partitions (see docs/DECISIONS.md, D-001).
--
-- Each checkpoint row now holds three audiences side by side, so a version
-- is saved and rolled back atomically as one row:
--   checkpoint          shared world, safe for every player (existing column)
--   character_knowledge { "<character name>": { ...private knowledge } }
--   dm_notes            DM-only world truth, secrets and who knows them
--
-- NULL = nothing recorded (all versions before this migration).

ALTER TABLE public.campaign_state
  ADD COLUMN IF NOT EXISTS character_knowledge JSONB,
  ADD COLUMN IF NOT EXISTS dm_notes JSONB;

ALTER TABLE public.campaign_checkpoint_versions
  ADD COLUMN IF NOT EXISTS character_knowledge JSONB,
  ADD COLUMN IF NOT EXISTS dm_notes JSONB;

ALTER TABLE public.campaign_checkpoint_drafts
  ADD COLUMN IF NOT EXISTS character_knowledge JSONB,
  ADD COLUMN IF NOT EXISTS dm_notes JSONB;
