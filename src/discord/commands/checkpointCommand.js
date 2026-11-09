import { config } from '../../config.js';
import { reply } from '../reply.js';
import {
  cancelCheckpointDraft,
  confirmCheckpointDraft,
  createCheckpointDraft,
  getActiveCheckpoint,
  listCheckpointVersions,
  rollbackCheckpoint
} from '../../services/checkpointService.js';

const COMMAND_PATTERN = /^\/checkpoint(?:\s+(.+))?\s*$/i;
const READ_ONLY_ACTIONS = new Set(['show', 'versions']);

const HELP_TEXT = [
  'Commands:',
  '/checkpoint show',
  '/checkpoint versions',
  '/checkpoint save',
  '/checkpoint confirm',
  '/checkpoint cancel',
  '/checkpoint rollback <version>'
].join('\n');

const formatJson = value => JSON.stringify(value, null, 2);

/** Returns the action text if `prompt` is a /checkpoint command, else null. */
export function parseCheckpointCommand(prompt) {
  const match = prompt.match(COMMAND_PATTERN);
  if (!match) return null;
  return (match[1] || 'help').trim().toLowerCase();
}

const actions = {
  async show({ guildId }) {
    const state = await getActiveCheckpoint(guildId);

    if (!state) return 'No shared checkpoint saved yet.';

    return (
      `Active checkpoint v${state.version}\n` +
      `Timeline: ${state.timeline_id}\n` +
      `Boundary: ${state.boundary_at || 'none'}\n` +
      formatJson(state.checkpoint)
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

  async save({ guildId, userId }) {
    const draft = await createCheckpointDraft({ guildId, authorId: userId });

    return (
      `Checkpoint draft based on v${draft.basedOnVersion}\n` +
      '**NOT YET SAVED**\n\n' +
      formatJson(draft.checkpoint) +
      '\n\nUse /checkpoint confirm or /checkpoint cancel.'
    );
  },

  async confirm({ guildId, userId }) {
    const { version } = await confirmCheckpointDraft({ guildId, userId });

    return (
      `Checkpoint v${version} confirmed. ` +
      'Main-adventure history boundary updated.'
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
    'Previous messages remain stored but are excluded.'
  );
}

function channelRestriction(channelId, action) {
  const { main, test } = config.channels;

  if (channelId === test && !READ_ONLY_ACTIONS.has(action)) {
    return (
      'Testing channel is read-only. ' +
      'Use #main-adventure for checkpoint changes.'
    );
  }

  if (channelId !== main && channelId !== test) {
    return (
      'Checkpoint commands are available only ' +
      'in #main-adventure or #dm-testing.'
    );
  }

  return null;
}

export async function handleCheckpointCommand(message, action) {
  const restriction = channelRestriction(message.channel.id, action);
  if (restriction) return reply(message, restriction);

  const ctx = { guildId: message.guild.id, userId: message.author.id };
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
