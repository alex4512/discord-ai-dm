-- Locations registry and event chronicle (see docs/DECISIONS.md, D-009).
--
--   locations  { "<place>": { name, description,
--                              state: { value, known_by },
--                              facts: [{ fact, known_by }],
--                              author_notes: [string] } }
--   chronicle  [ { event, location, known_by, version } ]   append-only
--
-- Same rows as the other partitions, so both are saved and rolled back
-- atomically with everything else. NULL = nothing recorded yet.

ALTER TABLE public.campaign_state
  ADD COLUMN IF NOT EXISTS locations JSONB,
  ADD COLUMN IF NOT EXISTS chronicle JSONB;

ALTER TABLE public.campaign_checkpoint_versions
  ADD COLUMN IF NOT EXISTS locations JSONB,
  ADD COLUMN IF NOT EXISTS chronicle JSONB;

ALTER TABLE public.campaign_checkpoint_drafts
  ADD COLUMN IF NOT EXISTS locations JSONB,
  ADD COLUMN IF NOT EXISTS chronicle JSONB;
