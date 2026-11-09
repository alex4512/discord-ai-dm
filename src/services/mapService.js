import { config } from '../config.js';
import { getState } from '../db/repositories/stateRepository.js';
import { getHistory, storeMessage } from '../db/repositories/messageRepository.js';
import { generateSceneMap } from '../ai/dungeonMaster.js';
import { MAP_NOTE_PREFIX, compactMapNote, normalizeMap } from './mapRender.js';

const MAP_HISTORY_CHARS = 8000;

/**
 * Builds the current scene's sketch for one channel (D-018) and records it
 * in that channel's history (D-019).
 *
 * Input is only what that channel may see: the shared checkpoint's
 * location/scene and the channel's own recent messages on the active
 * timeline. The latest stored map note of the channel is passed as
 * `previous_map`, so a new sketch updates it instead of starting over.
 *
 * The compact note is stored as a DM message under the /map command's
 * message id: later replies keep narration consistent with it, saves
 * summarize it, rollback abandons it, undo keeps it. #dm-testing stores
 * nothing, as always.
 */
export async function sceneMap({ guildId, channelId, messageId, authorId, request }) {
  const state = await getState(guildId);
  const checkpoint = state.checkpoint || {};
  const isTest = channelId === config.channels.test;

  const history = isTest
    ? []
    : await getHistory({
        guildId,
        channelId,
        timelineId: state.timeline_id,
        maxChars: MAP_HISTORY_CHARS
      });

  const previousMap = [...history]
    .reverse()
    .find(m => m.role === 'assistant' && m.content.startsWith(MAP_NOTE_PREFIX))
    ?.content || '';

  const raw = await generateSceneMap({
    current_location: checkpoint.location || '',
    current_scene: checkpoint.scene || '',
    party: checkpoint.party_npcs || [],
    previous_map: previousMap,
    recent_history_oldest_first: history.map(m => `${m.role === 'assistant' ? 'DM' : 'Player'}: ${m.content}`),
    request: request || ''
  });

  const map = normalizeMap(raw);

  if (!isTest && messageId) {
    await storeMessage({
      id: messageId,
      guildId,
      channelId,
      authorId,
      role: 'assistant',
      content: compactMapNote(map),
      timelineId: state.timeline_id
    });
  }

  return map;
}
