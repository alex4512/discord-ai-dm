import { config } from '../../config.js';
import { reply } from '../reply.js';
import { audienceForChannel, renderSnapshot } from '../checkpointView.js';
import {
  cancelCheckpointDraft,
  confirmCheckpointDraft,
  createCheckpointDraft,
  getActiveCheckpoint,
  getPendingDraft,
  listCheckpointVersions,
  rollbackCheckpoint
} from '../../services/checkpointService.js';

const COMMAND_PATTERN = /^\/checkpoint(?:\s+(.+))?\s*$/i;

const HELP_TEXT = [
  'Commands:',
  '/checkpoint show',
  '/checkpoint draft',
  '/checkpoint versions',
  '/checkpoint save',
  '/checkpoint confirm',
  '/checkpoint cancel',
  '/checkpoint rollback <version>'
].join('\n');

/** Returns the action text if `prompt` is a /checkpoint command, else null. */
export function parseCheckpointCommand(prompt) {
  const match = prompt.match(COMMAND_PATTERN);
  if (!match) return null;
  return (match[1] || 'help').trim().toLowerCase();
}

function formatBoundary(row) {
  if (row.boundary_seq == null) return 'none';
  return `message #${row.boundary_seq} (${new Date(row.boundary_at).toISOString()})`;
}

const actions = {
  async show({ guildId, audience }) {
    const state = await getActiveCheckpoint(guildId);

    if (!state) return 'No shared checkpoint saved yet.';

    return (
      `Active checkpoint v${state.version}\n` +
      `Timeline: ${state.timeline_id}\n` +
      `Boundary: ${formatBoundary(state)}\n\n` +
      renderSnapshot(state, audience)
    );
  },

  async draft({ guildId, audience }) {
    const draft = await getPendingDraft(guildId);

    if (!draft) return 'No checkpoint draft pending.';

    return (
      `Pending draft based on v${draft.based_on_version} ` +
      `(boundary ${formatBoundary(draft)})\n` +
      '**NOT YET SAVED**\n\n' +
      renderSnapshot(draft, audience)
    );
  },

  async versions({ guildId }) {
    const rows = await listCheckpointVersions(guildId);

    if (!rows.length) return 'No checkpoint versions.';

    return rows
      .map(row =>
        `v${row.version} | ${row.reason} | ` +
        new Date(row.created_at).toISOString()
      )
      .join('\n');
  },

  async save({ guildId, userId, audience }) {
    const draft = await createCheckpointDraft({ guildId, authorId: userId });

    const updated = draft.updatedCharacters.length
      ? draft.updatedCharacters.join(', ')
      : 'none';

    return (
      `Checkpoint draft based on v${draft.basedOnVersion}\n` +
      '**NOT YET SAVED**\n\n' +
      renderSnapshot(draft, audience) +
      `\n\nCharacter knowledge records generated: ${updated}.` +
      '\nUse /checkpoint confirm or /checkpoint cancel.'
    );
  },

  async confirm({ guildId, userId }) {
    const { version } = await confirmCheckpointDraft({ guildId, userId });

    return (
      `Checkpoint v${version} confirmed. ` +
      'History boundary updated for all campaign channels.'
    );
  },

  async cancel({ guildId, userId }) {
    const cancelled = await cancelCheckpointDraft({ guildId, userId });
    return cancelled ? 'Checkpoint draft cancelled.' : 'No draft owned by you.';
  }
};

async function rollback({ guildId, userId }, targetVersion) {
  const result = await rollbackCheckpoint({ guildId, userId, targetVersion });

  return (
    `Rollback completed: v${result.restoredVersion} restored ` +
    `as active v${result.version}.\n` +
    `New timeline: ${result.timelineId}\n` +
    'Shared world, character knowledge and DM notes were all restored.\n' +
    'Previous messages remain stored but are excluded.'
  );
}

const READ_ONLY = new Set(['show', 'draft', 'versions', 'help']);
const PRIVATE_ACTIONS = new Set(['show', 'draft', 'help']);

function channelRestriction(channelId, action) {
  const { main, test } = config.channels;
  const isPrivate = config.privateChannels.some(c => c.channelId === channelId);

  if (channelId === main) return null;

  if (channelId === test) {
    return READ_ONLY.has(action)
      ? null
      : 'Testing channel is read-only. Use #main-adventure for checkpoint changes.';
  }

  if (isPrivate) {
    return PRIVATE_ACTIONS.has(action)
      ? null
      : 'Private channels support only /checkpoint show and /checkpoint draft.';
  }

  return 'Checkpoint commands are not available in this channel.';
}

export async function handleCheckpointCommand(message, action, player) {
  const channelId = message.channel.id;
  const restriction = channelRestriction(channelId, action);
  if (restriction) return reply(message, restriction);

  const ctx = {
    guildId: message.guild.id,
    userId: message.author.id,
    audience: audienceForChannel(channelId, player)
  };
  const rollbackMatch = action.match(/^rollback\s+(\d+)$/);

  let response;
  if (Object.hasOwn(actions, action)) {
    response = await actions[action](ctx);
  } else if (rollbackMatch) {
    response = await rollback(ctx, Number(rollbackMatch[1]));
  } else {
    response = HELP_TEXT;
  }

  return reply(message, response);
}
