import { config } from '../../config.js';
import { UserFacingError } from '../../errors/UserFacingError.js';
import { reply } from '../reply.js';
import { audienceForChannel, renderSnapshot } from '../checkpointView.js';
import {
  getActiveCheckpoint,
  listCheckpointVersions,
  rollbackCheckpoint,
  saveCheckpoint,
  undoLastSave
} from '../../services/checkpointService.js';

const COMMAND_PATTERN = /^\/checkpoint(?:\s+(.+))?\s*$/i;

const HELP_TEXT = [
  'Commands:',
  '/checkpoint show',
  '/checkpoint versions',
  '/checkpoint save: summarize play since the last save (you can keep playing)',
  '/checkpoint undo: undo the last save, keeping all play',
  '/checkpoint rollback <version>: go back in the story (later play is abandoned)'
].join('\n');

// Saves run in the background, outside the per-guild request lock (D-011),
// one at a time per guild. Undo and rollback wait until a save finishes.
const savingGuilds = new Set();

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

function assertNotSaving(guildId) {
  if (savingGuilds.has(guildId)) {
    throw new UserFacingError('A save is in progress. Try again when it finishes.');
  }
}

/** Background save task; replies in the channel when done. */
function saveTask(message, { guildId, userId }) {
  savingGuilds.add(guildId);

  return async () => {
    try {
      const { version, updatedCharacters } =
        await saveCheckpoint({ guildId, authorId: userId });
      const updated = updatedCharacters.length ? updatedCharacters.join(', ') : 'none';

      await reply(
        message,
        `Saved as v${version}. Knowledge updated for: ${updated}. ` +
        '(`/checkpoint undo` if the summary came out wrong.)'
      );
    } catch (error) {
      if (error instanceof UserFacingError) {
        await reply(message, error.message).catch(() => {});
      } else {
        console.error('Checkpoint save error:', error);
        await reply(message, 'Save failed; nothing was saved. Check the server logs.')
          .catch(() => {});
      }
    } finally {
      savingGuilds.delete(guildId);
    }
  };
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

  async undo({ guildId, userId }) {
    assertNotSaving(guildId);
    const result = await undoLastSave({ guildId, userId });

    return (
      `Undid save v${result.undoneVersion}: v${result.restoredVersion} ` +
      `restored as v${result.version}. All play is kept and will be ` +
      'summarized again at the next save.'
    );
  }
};

async function rollback({ guildId, userId }, targetVersion) {
  assertNotSaving(guildId);
  const result = await rollbackCheckpoint({ guildId, userId, targetVersion });

  return (
    `Rollback completed: v${result.restoredVersion} restored ` +
    `as active v${result.version}.\n` +
    `New timeline: ${result.timelineId}\n` +
    'Shared world, character knowledge and DM notes were all restored.\n' +
    'Previous messages remain stored but are excluded.'
  );
}

const READ_ONLY = new Set(['show', 'versions', 'help']);
const PRIVATE_ACTIONS = new Set(['show', 'help']);

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
      : 'Private channels support only /checkpoint show.';
  }

  return 'Checkpoint commands are not available in this channel.';
}

/**
 * Handles a /checkpoint command. Returns a follow-up task to run after the
 * request lock is released (a save), or null.
 */
export async function handleCheckpointCommand(message, action, player) {
  const channelId = message.channel.id;
  const restriction = channelRestriction(channelId, action);
  if (restriction) {
    await reply(message, restriction);
    return null;
  }

  const ctx = {
    guildId: message.guild.id,
    userId: message.author.id,
    audience: audienceForChannel(channelId, player)
  };

  if (action === 'save') {
    assertNotSaving(ctx.guildId);
    await reply(message, 'Saving... you can keep playing; I\'ll post here when it\'s done.');
    return saveTask(message, ctx);
  }

  const rollbackMatch = action.match(/^rollback\s+(\d+)$/);

  let response;
  if (Object.hasOwn(actions, action)) {
    response = await actions[action](ctx);
  } else if (rollbackMatch) {
    response = await rollback(ctx, Number(rollbackMatch[1]));
  } else {
    response = HELP_TEXT;
  }

  await reply(message, response);
  return null;
}
