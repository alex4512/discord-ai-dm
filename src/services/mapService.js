import { config } from '../config.js';
import { getState } from '../db/repositories/stateRepository.js';
import { getHistory } from '../db/repositories/messageRepository.js';
import { generateSceneMap } from '../ai/dungeonMaster.js';
import { normalizeMap } from './mapRender.js';

const MAP_HISTORY_CHARS = 8000;

/**
 * Builds the current scene's sketch for one channel (D-018). Uses only what
 * that channel may see: the shared checkpoint's location/scene and the
 * channel's own recent messages on the active timeline (#dm-testing stores
 * none, so there it's the checkpoint and the request).
 */
export async function sceneMap({ guildId, channelId, request }) {
  const state = await getState(guildId);
  const checkpoint = state.checkpoint || {};

  const history = channelId === config.channels.test
    ? []
    : await getHistory({
        guildId,
        channelId,
        timelineId: state.timeline_id,
        maxChars: MAP_HISTORY_CHARS
      });

  const raw = await generateSceneMap({
    current_location: checkpoint.location || '',
    current_scene: checkpoint.scene || '',
    party: checkpoint.party_npcs || [],
    recent_history_oldest_first: history.map(m => `${m.role === 'assistant' ? 'DM' : 'Player'}: ${m.content}`),
    request: request || ''
  });

  return normalizeMap(raw);
}
