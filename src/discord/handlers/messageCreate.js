import { UserFacingError } from '../../errors/UserFacingError.js';
import { getPlayer } from '../../db/repositories/playerRepository.js';
import { playTurn } from '../../services/dungeonMasterService.js';
import { isAllowedMessage, isDmMentioned, stripDmMention } from '../access.js';
import { reply } from '../reply.js';
import { handleCheckpointCommand, parseCheckpointCommand } from '../commands/checkpointCommand.js';

// One request at a time per guild: turns and checkpoint operations
// share campaign state and must not interleave.
const busyGuilds = new Set();

async function handleRequest(message, prompt) {
  const guildId = message.guild.id;

  await message.channel.sendTyping();

  const player = await getPlayer(guildId, message.author.id);

  if (!player) {
    return reply(message, 'Your Discord account is not a registered player.');
  }

  const checkpointAction = parseCheckpointCommand(prompt);

  if (checkpointAction) {
    return handleCheckpointCommand(message, checkpointAction);
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

  console.log(
    `[DM] PC=${player.character_name} ` +
    `channel=${message.channel.id} ` +
    `version=${turn.version} ` +
    `timeline=${turn.timelineId} ` +
    `test=${turn.testMode}`
  );
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

  try {
    await handleRequest(message, prompt);
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
}
