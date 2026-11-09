import { randomUUID } from 'node:crypto';
import { config } from '../config.js';
import { LEGACY_CHECKPOINT_CHARACTER, REQUIRED_CHARACTERS } from '../constants.js';
import { getPlayers } from '../db/repositories/playerRepository.js';
import { ensureState } from '../db/repositories/stateRepository.js';
import { getLegacyCheckpoint } from '../db/repositories/checkpointRepository.js';

/**
 * Verifies the player registry is complete and makes sure the guild has
 * a campaign_state row with a timeline.
 */
export async function initializeCampaign(guildId) {
  const players = await getPlayers(guildId);
  const names = new Set(players.map(p => p.character_name));
  const missing = REQUIRED_CHARACTERS.filter(name => !names.has(name));

  if (missing.length) {
    throw new Error(
      `Campaign player registry is incomplete (missing: ${missing.join(', ')})`
    );
  }

  await ensureState(guildId, randomUUID());
}

/** The pre-versioning checkpoint; only relevant while state.version === 0. */
export function getCampaignLegacyCheckpoint(guildId) {
  return getLegacyCheckpoint({
    guildId,
    characterName: LEGACY_CHECKPOINT_CHARACTER,
    ownerId: config.users.kraavok
  });
}
