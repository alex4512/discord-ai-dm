import { config } from '../config.js';

/**
 * Whether the bot may respond to this message at all: right guild,
 * an allowed channel, and private channels only for their owner.
 */
export function isAllowedMessage(message) {
  if (!message.guild || message.guild.id !== config.discord.guildId) {
    return false;
  }

  const channelId = message.channel.id;

  if (!config.discord.allowedChannelIds.has(channelId)) {
    return false;
  }

  const privateChannel = config.privateChannels.find(
    c => c.channelId === channelId
  );

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
