import { getState } from '../db/repositories/stateRepository.js';
import { deleteMessage, getHistory, storeMessage } from '../db/repositories/messageRepository.js';
import { getPlayers } from '../db/repositories/playerRepository.js';
import { generateDmReply } from '../ai/dungeonMaster.js';
import {
  buildDmInstructions,
  buildPlayerInput,
  formatSharedTranscript
} from '../ai/prompts.js';
import { config } from '../config.js';
import { getCampaignLegacyCheckpoint } from './campaignService.js';
import { extractXpTags, xpHistoryNote } from './xp.js';
import { formatRoll } from './dice.js';
import {
  audienceForChannel,
  characterKnowledgeFor,
  dmNotesFor,
  chronicleFor,
  locationsFor,
  npcsFor,
  readersOf
} from './audience.js';

const SCENE_TAG = /\[\[\s*SCENE\s*:\s*([^\]\n]+?)\s*\]\]/gi;

/**
 * Splits the DM's hidden scene tag (DM rule 15, D-008) from the reply.
 * Returns the text players see and the last named scene, if any.
 */
export function extractSceneTag(text) {
  const matches = [...String(text).matchAll(SCENE_TAG)];
  const scene = matches.length ? matches.at(-1)[1].trim() : null;
  const clean = String(text).replace(SCENE_TAG, '').replace(/\n{3,}/g, '\n\n').trim();
  return { text: clean || (scene ? `*The scene shifts to ${scene}.*` : ''), scene };
}

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

  const [history, sharedHistory, legacyCheckpoint, players] = await Promise.all([
    testMode
      ? []
      : getHistory({
          guildId,
          channelId,
          timelineId: state.timeline_id,
          afterSeq: state.boundary_seq
        }),
    // A private channel also sees main-adventure play since the last save
    // (D-010): it is public to every player and newer than the checkpoint.
    audience.kind === 'character'
      ? getHistory({
          guildId,
          channelId: config.channels.main,
          timelineId: state.timeline_id,
          afterSeq: state.boundary_seq,
          maxChars: Math.floor(config.history.maxChars / 2)
        })
      : [],
    state.version === 0 ? getCampaignLegacyCheckpoint(guildId) : null,
    getPlayers(guildId)
  ]);

  const readers = readersOf(audience, players);
  const characterNames = players.map(p => p.character_name);

  const instructions = buildDmInstructions({
    channelId,
    audience,
    player,
    players,
    state,
    legacyCheckpoint,
    characterKnowledge: characterKnowledgeFor(state.character_knowledge, audience),
    dmNotes: dmNotesFor(state.dm_notes, readers, characterNames),
    npcs: npcsFor(state.npcs, readers, characterNames, { includeAuthorNotes: true }),
    locations: locationsFor(state.locations, readers, characterNames, { includeAuthorNotes: true }),
    chronicle: chronicleFor(state.chronicle, readers),
    recentSharedScene: sharedHistory.length
      ? formatSharedTranscript(sharedHistory)
      : null,
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
  let scene;
  let xpAwards = [];
  try {
    const raw = await generateDmReply({
      instructions,
      input: [...history, { role: 'user', content: playerInput }]
    });
    // XP tags first, so a reply that is only tags still gets the scene fallback.
    const xp = extractXpTags(raw.text, characterNames);
    const parsed = extractSceneTag(xp.text);
    // Monster/NPC dice are shown above the narration and kept in history (D-013).
    const rollLines = (raw.rolls || []).map(formatRoll);
    reply = { ...raw, text: [rollLines.join('\n'), parsed.text].filter(Boolean).join('\n\n') };
    scene = parsed.scene;
    xpAwards = xp.awards;
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
      // The award note keeps XP in history, so the next save records it.
      content: [reply.text, ...xpAwards.map(xpHistoryNote)].join('\n\n')
    });
  }

  return {
    text: reply.text,
    scene,
    xpAwards,
    audience,
    version: state.version,
    timelineId: state.timeline_id,
    testMode
  };
}
