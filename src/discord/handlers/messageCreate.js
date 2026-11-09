import { UserFacingError } from '../../errors/UserFacingError.js';
import { getPlayer } from '../../db/repositories/playerRepository.js';
import { playTurn } from '../../services/dungeonMasterService.js';
import { arrivalImage, requestedImage } from '../../services/imageService.js';
import { formatXpAward } from '../../services/xp.js';
import { isAllowedMessage, isDmMentioned, stripDmMention } from '../access.js';
import { reply, sendImage } from '../reply.js';
import { handleCheckpointCommand, parseCheckpointCommand } from '../commands/checkpointCommand.js';
import { handleWorldCommand } from '../commands/registryCommand.js';

// One request at a time per guild: turns and checkpoint operations
// share campaign state and must not interleave.
const busyGuilds = new Set();

// Images run after the request lock is released (they don't touch campaign
// state and can take ~30 s), one at a time per guild to bound spend.
const paintingGuilds = new Set();

const IMAGE_COMMAND = /^\/image(?:\s+([\s\S]+))?$/i;

/**
 * Handles one mention while the guild lock is held. May return a follow-up
 * `{ kind, task }` (an image or a checkpoint save) to run after the lock
 * is released.
 */
async function handleRequest(message, prompt) {
  const guildId = message.guild.id;

  await message.channel.sendTyping();

  const player = await getPlayer(guildId, message.author.id);

  if (!player) {
    await reply(message, 'Your Discord account is not a registered player.');
    return null;
  }

  const checkpointAction = parseCheckpointCommand(prompt);

  if (checkpointAction) {
    // A save returns its long-running work to run outside the lock (D-011).
    const task = await handleCheckpointCommand(message, checkpointAction, player);
    return task ? { kind: 'save', task } : null;
  }

  if (await handleWorldCommand(message, prompt, player)) {
    return null;
  }

  const imageMatch = prompt.trim().match(IMAGE_COMMAND);

  if (imageMatch) {
    await reply(message, '*The scene takes shape...*');
    return { kind: 'image', task: async () => {
      const image = await requestedImage({
        guildId,
        channelId: message.channel.id,
        userId: message.author.id,
        player,
        request: imageMatch[1]?.trim() || ''
      });
      await sendImage(message.channel, image);
    } };
  }

  const turn = await playTurn({
    guildId,
    channelId: message.channel.id,
    messageId: message.id,
    authorId: message.author.id,
    botUserId: message.client.user.id,
    player,
    prompt
  });

  await reply(message, turn.text);

  // XP computed in code from the DM's hidden tag (D-012); totals live in Avrae.
  for (const award of turn.xpAwards || []) {
    await message.channel.send({
      content: formatXpAward(award),
      allowedMentions: { parse: [] }
    });
  }

  console.log(
    `[DM] PC=${player.character_name} ` +
    `channel=${message.channel.id} ` +
    `version=${turn.version} ` +
    `timeline=${turn.timelineId} ` +
    `test=${turn.testMode}` +
    (turn.scene ? ` scene="${turn.scene}"` : '')
  );

  if (!turn.scene || turn.testMode) return null;

  // First arrival somewhere: establishing image (D-008). Never fails the turn.
  return { kind: 'image', task: async () => {
    const image = await arrivalImage({
      guildId,
      channelId: message.channel.id,
      userId: message.author.id,
      timelineId: turn.timelineId,
      audience: turn.audience,
      scene: turn.scene,
      replyText: turn.text
    });
    if (image) await sendImage(message.channel, image);
  } };
}

async function runImageTask(message, task) {
  const guildId = message.guild.id;

  if (paintingGuilds.has(guildId)) {
    return; // another image is being painted for this guild; skip quietly
  }

  paintingGuilds.add(guildId);
  try {
    await message.channel.sendTyping().catch(() => {});
    await task();
  } catch (error) {
    if (error instanceof UserFacingError) {
      await reply(message, error.message).catch(() => {});
    } else {
      console.error('Image error:', error);
    }
  } finally {
    paintingGuilds.delete(guildId);
  }
}

export async function onMessageCreate(message) {
  const botUserId = message.client.user?.id;

  if (
    message.author.bot ||
    !botUserId ||
    !isAllowedMessage(message) ||
    !isDmMentioned(message, botUserId)
  ) {
    return;
  }

  const prompt = stripDmMention(message.content, botUserId);

  if (!prompt) {
    return reply(message, 'Mention me with an action, question or command.');
  }

  const guildId = message.guild.id;

  if (busyGuilds.has(guildId)) {
    return reply(message, 'DM is processing another request. Retry shortly.');
  }

  busyGuilds.add(guildId);

  let followUp = null;
  try {
    followUp = await handleRequest(message, prompt);
  } catch (error) {
    if (error instanceof UserFacingError) {
      await reply(message, error.message);
    } else {
      console.error('Dungeon Master error:', error);
      await reply(message, 'Dungeon Master error. Check the server logs.')
        .catch(replyError => console.error('Failed to send error reply:', replyError));
    }
  } finally {
    busyGuilds.delete(guildId);
  }

  if (followUp?.kind === 'image') await runImageTask(message, followUp.task);
  // The save task handles its own errors and lock (checkpointCommand.js).
  if (followUp?.kind === 'save') await followUp.task();
}
