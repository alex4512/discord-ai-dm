import { getState } from '../db/repositories/stateRepository.js';
import { deleteMessage, getHistory, storeMessage } from '../db/repositories/messageRepository.js';
import { getPlayers } from '../db/repositories/playerRepository.js';
import { getNpcs } from '../db/repositories/npcRepository.js';
import { generateDmReply } from '../ai/dungeonMaster.js';
import { buildDmInstructions, buildPlayerInput } from '../ai/prompts.js';
import { getCampaignLegacyCheckpoint } from './campaignService.js';
import {
  audienceForChannel,
  characterKnowledgeFor,
  dmNotesFor,
  readersOf
} from './audience.js';

/**
 * Runs one Dungeon Master turn for a player message and persists both
 * sides of the exchange (except in the test channel).
 *
 * The prompt contains only what the channel's audience may see (D-004).
 * History starts at the checkpoint boundary in every channel; everything
 * before it is summarized in the shared checkpoint, the character's
 * knowledge record and the DM notes.
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
  const audience = audienceForChannel(channelId, player);
  const testMode = audience.kind === 'dm';
  const state = await getState(guildId);

  const [history, legacyCheckpoint, players, npcs] = await Promise.all([
    testMode
      ? []
      : getHistory({
          guildId,
          channelId,
          timelineId: state.timeline_id,
          afterSeq: state.boundary_seq
        }),
    state.version === 0 ? getCampaignLegacyCheckpoint(guildId) : null,
    getPlayers(guildId),
    getNpcs(guildId)
  ]);

  const instructions = buildDmInstructions({
    channelId,
    audience,
    player,
    players,
    state,
    legacyCheckpoint,
    characterKnowledge: characterKnowledgeFor(state.character_knowledge, audience),
    dmNotes: dmNotesFor(
      state.dm_notes,
      readersOf(audience, players),
      players.map(p => p.character_name)
    ),
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
