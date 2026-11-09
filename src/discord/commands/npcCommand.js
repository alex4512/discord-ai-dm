import { config } from '../../config.js';
import { reply } from '../reply.js';
import { getActiveCheckpoint } from '../../services/checkpointService.js';
import { getPlayers } from '../../db/repositories/playerRepository.js';
import { audienceForChannel, npcsFor, readersOf } from '../../services/audience.js';
import { addAuthorNote } from '../../services/npcService.js';
import { findNpcKey } from '../../services/npcRegistry.js';

const COMMAND_PATTERN = /^\/npc(?:\s+([\s\S]+))?$/i;

const HELP_TEXT = [
  'Commands:',
  '/npc list',
  '/npc show <name>',
  '/npc note <name>: <text>   (#dm-testing only; DM-authored truth)'
].join('\n');

/** Returns the argument text if `prompt` is an /npc command, else null. */
export function parseNpcCommand(prompt) {
  const match = prompt.trim().match(COMMAND_PATTERN);
  if (!match) return null;
  return (match[1] || 'help').trim();
}

async function npcsForChannel(guildId, channelId, player) {
  const state = await getActiveCheckpoint(guildId);
  const players = await getPlayers(guildId);
  const audience = audienceForChannel(channelId, player);
  const readers = readersOf(audience, players);

  // Player-facing output never shows author_notes (D-007).
  return npcsFor(state?.npcs, readers, players.map(p => p.character_name));
}

async function list(ctx) {
  const npcs = await npcsForChannel(ctx.guildId, ctx.channelId, ctx.player);
  const entries = Object.values(npcs);

  if (!entries.length) {
    return 'No NPCs have come up for this channel yet. Characters may know more in their private channels.';
  }

  return entries
    .map(npc => {
      const extra = [npc.role, typeof npc.status === 'object' ? npc.status?.value : npc.status]
        .filter(Boolean)
        .join(' | ');
      return `- **${npc.name}**${extra ? ` (${extra})` : ''}`;
    })
    .join('\n');
}

async function show(ctx, name) {
  if (!name) return 'Usage: /npc show <name>';

  const npcs = await npcsForChannel(ctx.guildId, ctx.channelId, ctx.player);
  const key = findNpcKey(npcs, name);

  if (!key) return `No NPC named "${name}" is known here.`;

  return `**${key}**\n${JSON.stringify(npcs[key], null, 2)}`;
}

async function note(ctx, rest) {
  if (ctx.channelId !== config.channels.test) {
    return '/npc note is only available in #dm-testing.';
  }

  const separator = rest.indexOf(':');
  if (separator < 0) return 'Usage: /npc note <name>: <text>';

  const { version, name } = await addAuthorNote({
    guildId: ctx.guildId,
    userId: ctx.userId,
    npcName: rest.slice(0, separator),
    note: rest.slice(separator + 1)
  });

  return (
    `Author note added to **${name}** as checkpoint v${version}. ` +
    'Any pending draft must be saved again.'
  );
}

export async function handleNpcCommand(message, args, player) {
  const ctx = {
    guildId: message.guild.id,
    channelId: message.channel.id,
    userId: message.author.id,
    player
  };

  const [action] = args.split(/\s+/);
  const rest = args.slice(action.length).trim();
  const verb = action.toLowerCase();

  let response;
  if (verb === 'list') response = await list(ctx);
  else if (verb === 'show') response = await show(ctx, rest);
  else if (verb === 'note') response = await note(ctx, rest);
  else response = HELP_TEXT;

  return reply(message, response);
}
