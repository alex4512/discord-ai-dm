import { config } from '../config.js';
import { getState } from '../db/repositories/stateRepository.js';
import { deleteMessage, getHistory, storeMessage } from '../db/repositories/messageRepository.js';
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
  const historyAfterSeq =
    channelId === config.channels.main ? state.boundary_seq : null;

  const [history, legacyCheckpoint, players, npcs] = await Promise.all([
    testMode
      ? []
      : getHistory({
          guildId,
          channelId,
          timelineId: state.timeline_id,
          afterSeq: historyAfterSeq
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
  const base = { guildId, channelId, timelineId: state.timeline_id };

  // Persist the player's message on receipt (after loading history, so it
  // is not duplicated in the prompt). This gives it a seq before the model
  // runs, so a concurrent checkpoint draft sees it.
  if (!testMode) {
    await storeMessage({
      ...base,
      id: messageId,
      authorId,
      role: 'user',
      content: playerInput
    });
  }

  let reply;
  try {
    reply = await generateDmReply({
      instructions,
      input: [...history, { role: 'user', content: playerInput }]
    });
  } catch (error) {
    // No DM answer: drop the orphaned player message so a retry is clean.
    if (!testMode) await deleteMessage(messageId);
    throw error;
  }

  if (!testMode) {
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
