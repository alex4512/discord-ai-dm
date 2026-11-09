import { config } from '../config.js';
import { UserFacingError } from '../errors/UserFacingError.js';
import { buildImagePrompt, generateImage, imageSettings } from '../ai/images.js';
import { getState } from '../db/repositories/stateRepository.js';
import { getPlayers } from '../db/repositories/playerRepository.js';
import { getHistory } from '../db/repositories/messageRepository.js';
import * as imageRepo from '../db/repositories/imageRepository.js';
import { audienceForChannel, locationsFor, readersOf } from './audience.js';
import { findKey } from './registry.js';

const REQUEST_HISTORY_MESSAGES = 6;

/** Stable cache/arrival key per audience (D-008). */
export function audienceKey(audience) {
  return audience.kind === 'character' ? `character:${audience.name}` : audience.kind;
}

async function underDailyLimit(guildId) {
  return (await imageRepo.countRecentImages(guildId)) < config.images.dailyLimit;
}

async function generateAndLog({ guildId, channelId, userId, trigger, material }) {
  const prompt = await buildImagePrompt(material);
  const image = await generateImage(prompt);
  const { model, size, quality } = imageSettings();

  await imageRepo.logImageGeneration({
    guildId, channelId, userId, trigger, model, size, quality, prompt
  });

  return { image, prompt };
}

/**
 * Establishing image on the first arrival of an audience at a place on the
 * current timeline (D-008). Returns a Buffer, or null when nothing should
 * be posted (already arrived, daily limit reached). Reuses the stored image
 * for this place + audience if there is one (free).
 *
 * Only material this channel may see goes into the prompt: the DM reply
 * just posted here, plus the place as this audience knows it.
 */
export async function arrivalImage({ guildId, channelId, userId, timelineId, audience, scene, replyText }) {
  const state = await getState(guildId);
  const players = await getPlayers(guildId);
  const names = players.map(p => p.character_name);
  const key = findKey(state.locations, scene) || scene.trim();
  const audKey = audienceKey(audience);

  const first = await imageRepo.recordArrival({
    guildId, timelineId, audienceKey: audKey, locationKey: key
  });
  if (!first) return null;

  const cached = await imageRepo.getSceneImage({ guildId, audienceKey: audKey, locationKey: key });
  if (cached) return cached.image;

  if (!(await underDailyLimit(guildId))) return null;

  const known = locationsFor(state.locations, readersOf(audience, players), names);
  const place = known[findKey(known, key)] || null;

  const { image, prompt } = await generateAndLog({
    guildId,
    channelId,
    userId,
    trigger: 'arrival',
    material: {
      place_name: key,
      place_as_known_here: place && { description: place.description, state: place.state },
      scene_as_narrated: replyText
    }
  });

  await imageRepo.saveSceneImage({ guildId, audienceKey: audKey, locationKey: key, prompt, image });
  return image;
}

/**
 * /image [request]: a picture of the current scene in this channel, built
 * only from this channel's recent history and the request (D-008).
 */
export async function requestedImage({ guildId, channelId, userId, player, request }) {
  if (!(await underDailyLimit(guildId))) {
    throw new UserFacingError(
      `The image limit (${config.images.dailyLimit} per 24 hours) has been reached. Try again later.`
    );
  }

  const state = await getState(guildId);
  const audience = audienceForChannel(channelId, player);
  const history = audience.kind === 'dm'
    ? []
    : await getHistory({
        guildId,
        channelId,
        timelineId: state.timeline_id,
        afterSeq: state.boundary_seq,
        limit: REQUEST_HISTORY_MESSAGES
      });

  const { image } = await generateAndLog({
    guildId,
    channelId,
    userId,
    trigger: 'request',
    material: {
      request: request || 'the current scene',
      recent_scene: history.map(m => m.content)
    }
  });

  return image;
}
