-- Monotonic message ordering + sequence-based checkpoint boundaries.
--
-- messages.id mixes Discord snowflakes and OpenAI response ids, and
-- created_at only reflects when a row was written, so neither is a safe
-- cursor. seq is a database-assigned, strictly increasing number used for
-- ordering and as the checkpoint high-water mark (boundary_seq).
--
-- boundary_at is kept for display only.

-- ---------- messages.seq ----------

ALTER TABLE public.messages ADD COLUMN IF NOT EXISTS seq BIGINT;

-- Backfill existing rows in their current chronological order.
WITH ordered AS (
  SELECT id, ROW_NUMBER() OVER (ORDER BY created_at, id) AS rn
  FROM public.messages
)
UPDATE public.messages AS m
SET seq = o.rn
FROM ordered AS o
WHERE m.id = o.id
  AND m.seq IS NULL;

CREATE SEQUENCE IF NOT EXISTS public.messages_seq_seq
  OWNED BY public.messages.seq;

SELECT setval(
  'public.messages_seq_seq',
  COALESCE((SELECT MAX(seq) FROM public.messages), 0) + 1,
  false
);

ALTER TABLE public.messages
  ALTER COLUMN seq SET DEFAULT nextval('public.messages_seq_seq'),
  ALTER COLUMN seq SET NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS messages_seq_key
  ON public.messages (seq);

CREATE INDEX IF NOT EXISTS idx_messages_history
  ON public.messages (guild_id, timeline_id, channel_id, seq);

-- ---------- boundary_seq ----------
-- NULL means "no boundary": all active-timeline history is included.

ALTER TABLE public.campaign_state
  ADD COLUMN IF NOT EXISTS boundary_seq BIGINT;

ALTER TABLE public.campaign_checkpoint_versions
  ADD COLUMN IF NOT EXISTS boundary_seq BIGINT;

ALTER TABLE public.campaign_checkpoint_drafts
  ADD COLUMN IF NOT EXISTS boundary_seq BIGINT;

-- Backfill: the boundary becomes the last message stored at or before
-- boundary_at (0 if none), preserving the old `created_at > boundary_at`
-- filtering exactly.

UPDATE public.campaign_state AS s
SET boundary_seq = COALESCE((
  SELECT MAX(m.seq) FROM public.messages AS m
  WHERE m.guild_id = s.guild_id AND m.created_at <= s.boundary_at
), 0)
WHERE s.boundary_at IS NOT NULL
  AND s.boundary_seq IS NULL;

UPDATE public.campaign_checkpoint_versions AS v
SET boundary_seq = COALESCE((
  SELECT MAX(m.seq) FROM public.messages AS m
  WHERE m.guild_id = v.guild_id AND m.created_at <= v.boundary_at
), 0)
WHERE v.boundary_at IS NOT NULL
  AND v.boundary_seq IS NULL;

UPDATE public.campaign_checkpoint_drafts AS d
SET boundary_seq = COALESCE((
  SELECT MAX(m.seq) FROM public.messages AS m
  WHERE m.guild_id = d.guild_id AND m.created_at <= d.boundary_at
), 0)
WHERE d.boundary_at IS NOT NULL
  AND d.boundary_seq IS NULL;
