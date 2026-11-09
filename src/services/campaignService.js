import { randomUUID } from 'node:crypto';
import { LEGACY_CHECKPOINT_CHARACTER } from '../constants.js';
import { getPlayers } from '../db/repositories/playerRepository.js';
import { ensureState } from '../db/repositories/stateRepository.js';
import { getLegacyCheckpoint } from '../db/repositories/checkpointRepository.js';
import { loadRoster } from './roster.js';

/**
 * Loads the player roster and private channels from the database (D-020;
 * at least one player required) and makes sure the guild has a
 * campaign_state row with a timeline.
 */
export async function initializeCampaign(guildId) {
  const roster = await loadRoster(guildId);
  await ensureState(guildId, randomUUID());
  return roster;
}

/**
 * The pre-versioning checkpoint; only relevant while state.version === 0.
 * It belongs to the campaign's first character (historical data, not part
 * of the roster logic).
 */
export async function getCampaignLegacyCheckpoint(guildId) {
  const owner = (await getPlayers(guildId))
    .find(p => p.character_name === LEGACY_CHECKPOINT_CHARACTER);
  if (!owner) return null;

  return getLegacyCheckpoint({
    guildId,
    characterName: LEGACY_CHECKPOINT_CHARACTER,
    ownerId: owner.discord_user_id
  });
}
