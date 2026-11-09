import { config } from '../config.js';
import { getState } from '../db/repositories/stateRepository.js';
import { getHistory, storeMessage } from '../db/repositories/messageRepository.js';
import { getPlayers } from '../db/repositories/playerRepository.js';
import { getNpcs } from '../db/repositories/npcRepository.js';
import { generateDmReply } from '../ai/dungeonMaster.js';
import { buildDmInstructions, buildPlayerInput } from '../ai/prompts.js';
import { getCampaignLegacyCheckpoint } from './campaignService.js';

/**
 * Runs one Dungeon Master turn for a player message and persists both
 * sides of the exchange (except in the test channel).
 */
export async function playTurn({
  guildId,
  channelId,
  messageId,
  authorId,
  botUserId,
  player,
  prompt
}) {
  const testMode = channelId === config.channels.test;
  const state = await getState(guildId);

  // Main-adventure history is trimmed at the checkpoint boundary.
  // Private channels keep their whole active-timeline history until
  // private checkpoints exist.
  const historyBoundary =
    channelId === config.channels.main ? state.boundary_at : null;

  const [history, legacyCheckpoint, players, npcs] = await Promise.all([
    testMode
      ? []
      : getHistory({
          guildId,
          channelId,
          timelineId: state.timeline_id,
          boundaryAt: historyBoundary
        }),
    state.version === 0 ? getCampaignLegacyCheckpoint(guildId) : null,
    getPlayers(guildId),
    getNpcs(guildId)
  ]);

  const instructions = buildDmInstructions({
    channelId,
    player,
    players,
    state,
    legacyCheckpoint,
    npcs,
    testMode
  });

  const playerInput = buildPlayerInput(player, prompt);

  const reply = await generateDmReply({
    instructions,
    input: [...history, { role: 'user', content: playerInput }]
  });

  if (!testMode) {
    const base = { guildId, channelId, timelineId: state.timeline_id };

    await storeMessage({
      ...base,
      id: messageId,
      authorId,
      role: 'user',
      content: playerInput
    });

    await storeMessage({
      ...base,
      id: reply.id,
      authorId: botUserId,
      role: 'assistant',
      content: reply.text
    });
  }

  return {
    text: reply.text,
    version: state.version,
    timelineId: state.timeline_id,
    testMode
  };
}
