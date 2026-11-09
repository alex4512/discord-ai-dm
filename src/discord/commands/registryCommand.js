import { config } from '../../config.js';
import { reply } from '../reply.js';
import { getActiveCheckpoint } from '../../services/checkpointService.js';
import { getPlayers } from '../../db/repositories/playerRepository.js';
import { audienceForChannel, chronicleFor, readersOf, registryFor } from '../../services/audience.js';
import { addAuthorNote } from '../../services/worldService.js';
import { REGISTRY_KINDS, findKey } from '../../services/registry.js';
import { awardEntries, parseXpTag, xpHistoryNote } from '../../services/xp.js';
import { recordAwards, setXp, xpReport } from '../../services/progressService.js';
import { announceXp, formatXpStatus } from '../xpAnnounce.js';
import { storeMessage } from '../../db/repositories/messageRepository.js';

/** Readers + filtered views for the channel a command was sent in. */
async function channelView(ctx) {
  const state = await getActiveCheckpoint(ctx.guildId);
  const players = await getPlayers(ctx.guildId);
  const audience = audienceForChannel(ctx.channelId, ctx.player);
  return {
    state,
    readers: readersOf(audience, players),
    names: players.map(p => p.character_name)
  };
}

const tagValue = v => (v && typeof v === 'object' ? v.value : v);

/**
 * Builds a parser + handler for a registry command (/npc, /location).
 * Player-facing output never shows author_notes (D-007).
 */
function registryCommand({ command, kind }) {
  const { label, perceivable, tagged } = REGISTRY_KINDS[kind];
  const pattern = new RegExp(`^${command}(?:\\s+([\\s\\S]+))?$`, 'i');
  const help = [
    'Commands:',
    `${command} list`,
    `${command} show <name>`,
    `${command} note <name>: <text>   (#dm-testing only; DM-authored truth)`
  ].join('\n');

  async function entriesFor(ctx) {
    const { state, readers, names } = await channelView(ctx);
    return registryFor(kind, state?.[kind], readers, names);
  }

  async function list(ctx) {
    const entries = Object.values(await entriesFor(ctx));

    if (!entries.length) {
      return `No ${label}s have come up for this channel yet. ` +
        'Characters may know more in their private channels.';
    }

    return entries
      .map(entry => {
        const extra = [entry[perceivable[0]], ...tagged.map(f => tagValue(entry[f]))]
          .filter(Boolean)
          .join(' | ');
        return `- **${entry.name}**${extra ? ` (${extra})` : ''}`;
      })
      .join('\n');
  }

  async function show(ctx, name) {
    if (!name) return `Usage: ${command} show <name>`;
    const entries = await entriesFor(ctx);
    const key = findKey(entries, name);
    if (!key) return `No ${label} named "${name}" is known here.`;
    return `**${key}**\n${JSON.stringify(entries[key], null, 2)}`;
  }

  async function note(ctx, rest) {
    if (ctx.channelId !== config.channels.test) {
      return `${command} note is only available in #dm-testing.`;
    }
    const separator = rest.indexOf(':');
    if (separator < 0) return `Usage: ${command} note <name>: <text>`;

    const { version, name } = await addAuthorNote({
      kind,
      guildId: ctx.guildId,
      userId: ctx.userId,
      name: rest.slice(0, separator),
      note: rest.slice(separator + 1)
    });

    return `Author note added to **${name}** as checkpoint v${version}. ` +
      'Any pending draft must be saved again.';
  }

  return {
    parse(prompt) {
      const match = prompt.trim().match(pattern);
      return match ? (match[1] || 'help').trim() : null;
    },

    async handle(message, args, ctx) {
      const [action] = args.split(/\s+/);
      const rest = args.slice(action.length).trim();
      const verb = action.toLowerCase();

      let response;
      if (verb === 'list') response = await list(ctx);
      else if (verb === 'show') response = await show(ctx, rest);
      else if (verb === 'note') response = await note(ctx, rest);
      else response = help;

      return reply(message, response);
    }
  };
}

const CHRONICLE_LIST_LIMIT = 20;

/** /chronicle: recent events this channel's readers know (D-009). */
const chronicleCommand = {
  parse(prompt) {
    return /^\/chronicle\s*$/i.test(prompt.trim()) ? 'list' : null;
  },

  async handle(message, _args, ctx) {
    const { state, readers } = await channelView(ctx);
    const events = chronicleFor(state?.chronicle, readers, { limit: CHRONICLE_LIST_LIMIT });

    const text = events.length
      ? events
          .map(e => `- ${e.event}${e.location ? ` *(${e.location})*` : ''}`)
          .join('\n')
      : 'No events have been recorded for this channel yet.';

    return reply(message, text);
  }
};

const XP_HELP = [
  'XP commands (D-014):',
  '/xp: your XP and level (#dm-testing: everyone)',
  '/xp 3 goblin CR 1/4 | Kraavok, Looming Shade: award by hand',
  '/xp 100 solved the seal | Kraavok: plain amount',
  '/xp set <character> <total>: set a total (#dm-testing only)'
].join('\n');

const XP_SET = /^set\s+(.+?)\s+(\d+)$/i;

/**
 * `/xp`: show totals, set a total (DM), or award by hand with the same
 * syntax as the DM's hidden tag. Awards are recorded in the XP ledger; in a
 * campaign channel a note also goes into history for the next save.
 */
const xpCommand = {
  parse(prompt) {
    const match = prompt.trim().match(/^\/xp(?:\s+([\s\S]+))?$/i);
    return match ? (match[1] || '').trim() : null;
  },

  async handle(message, body, ctx) {
    const inTest = ctx.channelId === config.channels.test;

    if (!body) {
      const rows = await xpReport(ctx.guildId, inTest ? null : [ctx.player.character_name]);
      return reply(message, rows.map(formatXpStatus).join('\n') || XP_HELP);
    }

    const players = await getPlayers(ctx.guildId);
    const names = players.map(p => p.character_name);
    const setMatch = body.match(XP_SET);

    if (setMatch) {
      if (!inTest) return reply(message, 'Use /xp set in #dm-testing.');
      const name = names.find(n => n.toLowerCase() === setMatch[1].trim().toLowerCase());
      const result = name && await setXp({
        guildId: ctx.guildId,
        channelId: ctx.channelId,
        userId: ctx.userId,
        characterName: name,
        targetXp: Number(setMatch[2])
      });
      return reply(message, result ? formatXpStatus(result) : `Unknown character "${setMatch[1]}".`);
    }

    const award = parseXpTag(body, names);
    if (!award) return reply(message, XP_HELP);

    if (config.campaignChannelIds.includes(ctx.channelId)) {
      const state = await getActiveCheckpoint(ctx.guildId);
      if (state) {
        await storeMessage({
          id: message.id,
          guildId: ctx.guildId,
          channelId: ctx.channelId,
          authorId: ctx.userId,
          role: 'assistant',
          content: xpHistoryNote(award),
          timelineId: state.timeline_id
        });
      }
    }

    const results = await recordAwards({
      guildId: ctx.guildId,
      channelId: ctx.channelId,
      userId: ctx.userId,
      entries: awardEntries(award)
    });
    return announceXp(message, { award, results });
  }
};

/** World commands, tried in order by the message handler. */
export const WORLD_COMMANDS = [
  registryCommand({ command: '/npc', kind: 'npcs' }),
  registryCommand({ command: '/location', kind: 'locations' }),
  chronicleCommand,
  xpCommand
];

/** Runs the first matching world command. Returns true if one matched. */
export async function handleWorldCommand(message, prompt, player) {
  for (const command of WORLD_COMMANDS) {
    const args = command.parse(prompt);
    if (args === null) continue;

    await command.handle(message, args, {
      guildId: message.guild.id,
      channelId: message.channel.id,
      userId: message.author.id,
      player
    });
    return true;
  }
  return false;
}
