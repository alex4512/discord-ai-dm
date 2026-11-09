import { DISCORD_CHUNK_SIZE } from '../constants.js';

const CHUNK_PATTERN = new RegExp(`[\\s\\S]{1,${DISCORD_CHUNK_SIZE}}`, 'g');

/**
 * Replies to a message, splitting long content across several messages.
 * Mentions in the content are never resolved (no accidental pings).
 */
export async function reply(message, content) {
  const chunks = String(content).match(CHUNK_PATTERN) || ['(empty)'];

  for (const [index, chunk] of chunks.entries()) {
    const payload = {
      content: chunk,
      allowedMentions: { parse: [], repliedUser: false }
    };

    if (index === 0) {
      await message.reply(payload);
    } else {
      await message.channel.send(payload);
    }
  }
}
