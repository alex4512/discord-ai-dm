import { config } from '../config.js';
import { isAllowedChannel, privateChannelOf } from '../services/roster.js';

/**
 * Whether the bot may respond to this message at all: right guild,
 * #main-adventure, #dm-testing or a registered private channel (D-020),
 * and private channels only for their owner.
 */
export function isAllowedMessage(message) {
  if (!message.guild || message.guild.id !== config.discord.guildId) {
    return false;
  }

  const channelId = message.channel.id;

  if (!isAllowedChannel(channelId)) {
    return false;
  }

  const privateChannel = privateChannelOf(channelId);

  return !privateChannel || privateChannel.ownerId === message.author.id;
}

/** The bot is addressed by a user mention or the DM role mention. */
export function isDmMentioned(message, botUserId) {
  return (
    message.mentions.users.has(botUserId) ||
    message.mentions.roles.has(config.discord.dmRoleId)
  );
}

export function stripDmMention(content, botUserId) {
  return content
    .replace(new RegExp(`<@!?${botUserId}>`, 'g'), '')
    .replace(new RegExp(`<@&${config.discord.dmRoleId}>`, 'g'), '')
    .trim();
}
