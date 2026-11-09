import { getState } from '../db/repositories/stateRepository.js';
import { getPlayers } from '../db/repositories/playerRepository.js';
import { insertAwards, sumAwards } from '../db/repositories/xpRepository.js';
import { toSnapshot } from '../db/partitions.js';

/**
 * Experience kept by the bot (D-014). Current XP of a character =
 * the saved `progress` partition + awards on the active timeline after the
 * checkpoint boundary. A character with no saved XP yet starts at the
 * minimum for their registered level.
 */

// Player's Handbook (2014): total XP needed for each level.
const LEVEL_XP = [
  0, 300, 900, 2700, 6500, 14000, 23000, 34000, 48000, 64000,
  85000, 100000, 120000, 140000, 165000, 195000, 225000, 265000, 305000, 355000
];

export function levelForXp(xp) {
  let level = 1;
  while (level < LEVEL_XP.length && xp >= LEVEL_XP[level]) level++;
  return level;
}

/** XP needed for the next level, or null at level 20. */
export function nextLevelXp(level) {
  return level < LEVEL_XP.length ? LEVEL_XP[level] : null;
}

const minimumXp = level =>
  LEVEL_XP[Math.min(Math.max(Number(level) || 1, 1), LEVEL_XP.length) - 1];

/** Saved XP per registered character, defaulting to their level's minimum. */
function baseXp(progress, players) {
  return Object.fromEntries(players.map(p => [
    p.character_name,
    Number.isInteger(progress?.[p.character_name]?.xp)
      ? progress[p.character_name].xp
      : minimumXp(p.character_level)
  ]));
}

function addSums(base, sums) {
  return Object.fromEntries(
    Object.entries(base).map(([name, xp]) => [name, Math.max(0, xp + (sums[name] || 0))])
  );
}

/** Current XP per character for an already loaded state row. */
export async function currentXp(guildId, state, players) {
  const sums = await sumAwards({
    guildId,
    timelineId: state.timeline_id,
    afterSeq: state.boundary_seq
  });
  return addSums(baseXp(toSnapshot(state).progress, players), sums);
}

/** Players with `character_level` derived from current XP. */
export function withXpLevels(players, xpByName) {
  return players.map(p => (
    xpByName[p.character_name] === undefined
      ? p
      : { ...p, character_level: levelForXp(xpByName[p.character_name]) }
  ));
}

/**
 * The `progress` partition for a save covering awards in
 * (previous boundary, new boundary]. Every registered character is written.
 */
export async function foldProgress({ guildId, state, players, untilSeq }) {
  const sums = await sumAwards({
    guildId,
    timelineId: state.timeline_id,
    afterSeq: state.boundary_seq,
    untilSeq
  });
  const totals = addSums(baseXp(toSnapshot(state).progress, players), sums);
  return Object.fromEntries(Object.entries(totals).map(([name, xp]) => [name, { xp }]));
}

/**
 * Records `amount` XP for each character and reports totals before/after,
 * including level-ups. `entries`: [{ characterName, amount, reason }].
 */
export async function recordAwards({ guildId, channelId, userId, entries }) {
  const state = await getState(guildId);
  const players = await getPlayers(guildId);
  const before = await currentXp(guildId, state, players);

  await insertAwards({
    guildId,
    timelineId: state.timeline_id,
    channelId,
    createdBy: userId,
    entries
  });

  return entries.map(({ characterName, amount }) => {
    const from = before[characterName] ?? 0;
    const to = Math.max(0, from + amount);
    return {
      characterName,
      amount,
      xp: to,
      level: levelForXp(to),
      previousLevel: levelForXp(from)
    };
  });
}

/** Records the difference needed to bring a character to `targetXp`. */
export async function setXp({ guildId, channelId, userId, characterName, targetXp }) {
  const state = await getState(guildId);
  const players = await getPlayers(guildId);
  const current = await currentXp(guildId, state, players);

  if (current[characterName] === undefined) return null;

  const [result] = await recordAwards({
    guildId,
    channelId,
    userId,
    entries: [{
      characterName,
      amount: targetXp - current[characterName],
      reason: `set to ${targetXp} by DM`
    }]
  });
  return result;
}

/** Current XP and levels for the given character names (all if null). */
export async function xpReport(guildId, names = null) {
  const state = await getState(guildId);
  const players = await getPlayers(guildId);
  const xp = await currentXp(guildId, state, players);

  return players
    .filter(p => !names || names.includes(p.character_name))
    .map(p => {
      const level = levelForXp(xp[p.character_name]);
      return { characterName: p.character_name, xp: xp[p.character_name], level, next: nextLevelXp(level) };
    });
}
