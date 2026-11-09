-- NPCs as a versioned checkpoint partition (see docs/DECISIONS.md, D-007).
--
--   npcs  { "<npc name>": { name, role, appearance, personality,
--                           status:   { value, known_by },
--                           location: { value, known_by },
--                           facts:    [{ fact, known_by }],
--                           author_notes: [string] } }
--
-- Stored on the same rows as the other partitions, so NPC state is saved and
-- rolled back atomically with everything else. campaign_npcs is left as-is
-- (unversioned, unused by the bot after this change).
--
-- NULL = no NPCs recorded (all versions before this migration).

ALTER TABLE public.campaign_state
  ADD COLUMN IF NOT EXISTS npcs JSONB;

ALTER TABLE public.campaign_checkpoint_versions
  ADD COLUMN IF NOT EXISTS npcs JSONB;

ALTER TABLE public.campaign_checkpoint_drafts
  ADD COLUMN IF NOT EXISTS npcs JSONB;
