import { config } from '../config.js';
import { getRoster } from '../db/repositories/playerRepository.js';

/**
 * The players' private channels, loaded from campaign_players (D-020) and
 * kept in memory: access checks and audiences need them synchronously on
 * every message.
 *
 * Fail closed: a channel that isn't #main-adventure, #dm-testing or a
 * registered player's private channel is ignored by the bot. A private
 * channel that is missing from the database is therefore never treated as
 * a shared channel; the bot simply doesn't answer there.
 *
 * Loaded at startup. Anything that changes the roster (the planned
 * `/player add`, D-020 step 2) must call loadRoster() again.
 */
let privateChannels = Object.freeze([]);

export async function loadRoster(guildId) {
  const rows = await getRoster(guildId);

  if (!rows.length) {
    throw new Error('Campaign player registry is empty (campaign_players)');
  }

  const fixed = new Set([config.channels.main, config.channels.test]);
  const list = [];

  for (const row of rows) {
    if (!row.private_channel_id) {
      console.warn(`Player ${row.character_name} has no private channel.`);
      continue;
    }
    if (fixed.has(row.private_channel_id)) {
      throw new Error(
        `Private channel of ${row.character_name} is #main-adventure or #dm-testing`
      );
    }
    list.push(Object.freeze({
      channelId: row.private_channel_id,
      ownerId: row.discord_user_id,
      characterName: row.character_name
    }));
  }

  privateChannels = Object.freeze(list);
  return { players: rows.length, privateChannels: list.length };
}

export const getPrivateChannels = () => privateChannels;

/** The private channel entry for a channel id, or null. */
export const privateChannelOf = channelId =>
  privateChannels.find(c => c.channelId === channelId) || null;

export const isPrivateChannel = channelId => Boolean(privateChannelOf(channelId));

/** Private channel id of a character, or null. */
export const privateChannelOfCharacter = characterName =>
  privateChannels.find(c => c.characterName === characterName)?.channelId || null;

/** Channels whose messages feed the campaign timeline. */
export const isCampaignChannel = channelId =>
  channelId === config.channels.main || isPrivateChannel(channelId);

/** Channels the bot answers in at all. */
export const isAllowedChannel = channelId =>
  channelId === config.channels.test || isCampaignChannel(channelId);
