-- Players' private channels live in the database (D-020), not in .env.
--
--   campaign_players.private_channel_id   the player's private channel;
--                                         NULL = the player has none (they
--                                         still play in #main-adventure).
--
-- A private channel belongs to exactly one player per guild. Existing
-- players are filled in once from the old .env values (see OPERATIONS.md,
-- "Restoring a backup from before 0008").

ALTER TABLE public.campaign_players
  ADD COLUMN IF NOT EXISTS private_channel_id TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS campaign_players_private_channel_idx
  ON public.campaign_players (guild_id, private_channel_id)
  WHERE private_channel_id IS NOT NULL;
