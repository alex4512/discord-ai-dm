import { UserFacingError } from '../../errors/UserFacingError.js';
import { getPlayer } from '../../db/repositories/playerRepository.js';
import { playTurn } from '../../services/dungeonMasterService.js';
import { arrivalImage, requestedImage } from '../../services/imageService.js';
import { announceXp } from '../xpAnnounce.js';
import { isAllowedMessage, isDmMentioned, stripDmMention } from '../access.js';
import { reply, sendImage } from '../reply.js';
import { sceneMap } from '../../services/mapService.js';
import { renderLegendText, renderPng, renderTextMap } from '../../services/mapRender.js';
import { handleCheckpointCommand, parseCheckpointCommand } from '../commands/checkpointCommand.js';
import { handleWorldCommand } from '../commands/registryCommand.js';

// One request at a time per guild: turns and checkpoint operations
// share campaign state and must not interleave.
const busyGuilds = new Set();

// Images run after the request lock is released (they don't touch campaign
// state and can take ~30 s), one at a time per guild to bound spend.
const paintingGuilds = new Set();

const IMAGE_COMMAND = /^\/image(?:\s+([\s\S]+))?$/i;
const MAP_COMMAND = /^\/map(?:\s+([\s\S]+))?$/i;

// Maps run after the lock too (no campaign state), one at a time per guild.
const sketchingGuilds = new Set();

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

  const mapMatch = prompt.trim().match(MAP_COMMAND);

  if (mapMatch) {
    // Sketch map (D-018): `/map [focus]` = drawn PNG, `/map text [focus]` = grid.
    const args = mapMatch[1]?.trim() || '';
    const asText = /^text\b/i.test(args);
    const focus = asText ? args.replace(/^text\b\s*/i, '') : args;
    await reply(message, '*The DM sketches the scene...*');
    return { kind: 'map', task: async () => {
      const map = await sceneMap({ guildId, channelId: message.channel.id, request: focus });
      if (asText) {
        await message.channel.send({ content: renderTextMap(map), allowedMentions: { parse: [] } });
      } else {
        await sendImage(message.channel, renderPng(map), 'map.png');
        const legend = renderLegendText(map);
        if (legend) await message.channel.send({ content: legend, allowedMentions: { parse: [] } });
      }
    } };
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

  // XP from the DM's hidden tag, computed and kept by the bot (D-012, D-014).
  for (const xp of turn.xpResults || []) {
    await announceXp(message, { ...xp, testMode: turn.testMode });
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

/**
 * Runs a follow-up outside the request lock, one at a time per guild per
 * kind. Images skip quietly when busy; maps say so. Failures never break
 * the turn that triggered them.
 */
async function runFollowUpTask(message, task, { locks, label, busyText = null, failText = null }) {
  const guildId = message.guild.id;

  if (locks.has(guildId)) {
    if (busyText) await reply(message, busyText).catch(() => {});
    return;
  }

  locks.add(guildId);
  try {
    await message.channel.sendTyping().catch(() => {});
    await task();
  } catch (error) {
    if (error instanceof UserFacingError) {
      await reply(message, error.message).catch(() => {});
    } else {
      console.error(`${label} error:`, error);
      if (failText) await reply(message, failText).catch(() => {});
    }
  } finally {
    locks.delete(guildId);
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

  if (followUp?.kind === 'image') {
    await runFollowUpTask(message, followUp.task, { locks: paintingGuilds, label: 'Image' });
  }
  if (followUp?.kind === 'map') {
    await runFollowUpTask(message, followUp.task, {
      locks: sketchingGuilds,
      label: 'Map',
      busyText: 'A map is already being sketched. Try again in a moment.',
      failText: 'Could not sketch the map. Check the server logs.'
    });
  }
  // The save task handles its own errors and lock (checkpointCommand.js).
  if (followUp?.kind === 'save') await followUp.task();
}
