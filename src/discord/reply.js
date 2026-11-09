import { DISCORD_CHUNK_SIZE } from '../constants.js';

/**
 * Splits text into chunks of at most `size` characters, breaking at line
 * boundaries. Only a single line longer than `size` is hard-split.
 */
export function splitIntoChunks(text, size = DISCORD_CHUNK_SIZE) {
  const chunks = [];
  let current = '';

  for (const line of text.split('\n')) {
    const candidate = current ? `${current}\n${line}` : line;

    if (candidate.length <= size) {
      current = candidate;
      continue;
    }

    if (current.trim()) chunks.push(current);

    // A single overlong line: hard-split it.
    let rest = line;
    while (rest.length > size) {
      chunks.push(rest.slice(0, size));
      rest = rest.slice(size);
    }
    current = rest;
  }

  if (current.trim()) chunks.push(current);
  return chunks;
}

/**
 * Replies to a message, splitting long content across several messages.
 * Mentions in the content are never resolved (no accidental pings).
 */
export async function reply(message, content) {
  const chunks = splitIntoChunks(String(content));
  if (!chunks.length) chunks.push('(empty)');

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
