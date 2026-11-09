import { config } from '../config.js';
import { nextLevelXp } from '../services/progressService.js';
import { getPrivateChannels } from '../services/roster.js';
import { formatXpAward } from '../services/xp.js';

const send = (channel, content) =>
  channel.send({ content, allowedMentions: { parse: [] } });

const fmt = n => Number(n).toLocaleString('en-US');

/** "Kraavok: 2,775 XP · level 4 · level 5 at 6,500" */
export function formatXpStatus({ characterName, xp, level }) {
  const next = nextLevelXp(level);
  return (
    `${characterName}: ${fmt(xp)} XP · level ${level}` +
    (next ? ` · level ${level + 1} at ${fmt(next)}` : '')
  );
}

/** Private channel id per character name (D-020). */
function privateChannelsByName() {
  return Object.fromEntries(getPrivateChannels().map(c => [c.characterName, c.channelId]));
}

/**
 * Posts an XP award (D-014): the award line in the channel; totals only in
 * the owner's private channel or #dm-testing; level-ups in each levelling
 * character's private channel.
 */
export async function announceXp(message, { award, results, testMode = false }) {
  const channelId = message.channel.id;
  const privateByName = privateChannelsByName();
  const ownerHere = Object.keys(privateByName).find(n => privateByName[n] === channelId);

  const lines = [formatXpAward(award)];
  if (testMode) {
    lines.push('*(test mode: not recorded)*');
  } else if (channelId === config.channels.test) {
    lines.push(...results.map(formatXpStatus));
  } else if (ownerHere) {
    lines.push(...results.filter(r => r.characterName === ownerHere).map(formatXpStatus));
  }
  await send(message.channel, lines.join('\n'));

  for (const result of results) {
    if (result.level <= result.previousLevel) continue;

    const target = privateByName[result.characterName];
    if (!target) continue;
    const channel = target === channelId
      ? message.channel
      : await message.client.channels.fetch(target).catch(() => null);
    if (!channel) continue;

    await send(
      channel,
      `🎉 **${result.characterName} reaches level ${result.level}!** ` +
      `(${fmt(result.xp)} XP.) Update your character sheet.`
    );
  }
}
