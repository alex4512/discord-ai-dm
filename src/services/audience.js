import { config } from '../config.js';

/**
 * Who can read a channel (docs/DECISIONS.md, D-002):
 *   #dm-testing      -> dm         (the DM's debug channel: everything)
 *   private channel  -> character  (shared world + own knowledge)
 *   anything else    -> shared     (every player)
 *
 * Private channels are owner-only (enforced in discord/access.js), so the
 * author of a message there is the channel's character.
 */
export function audienceForChannel(channelId, player) {
  if (channelId === config.channels.test) {
    return { kind: 'dm' };
  }

  if (config.privateChannels.some(c => c.channelId === channelId)) {
    return { kind: 'character', name: player.character_name };
  }

  return { kind: 'shared' };
}

/** Character names that read this audience's output; null = DM (no limit). */
export function readersOf(audience, players) {
  if (audience.kind === 'dm') return null;
  if (audience.kind === 'character') return [audience.name];
  return players.map(p => p.character_name);
}

const normalize = name => String(name).trim().toLowerCase();

function knownByAll(entry, wanted) {
  if (!entry || typeof entry !== 'object' || !Array.isArray(entry.known_by)) {
    return false; // untagged or legacy-format entry: fail closed
  }
  const knownBy = entry.known_by.map(normalize);
  return wanted.every(reader => knownBy.includes(reader));
}

const OBSERVABLE_FIELD = 'observable_world_state';
const MIN_NAME_PART = 4;

/** Name parts that must not appear in observable state ("Looming", "Shade"). */
function nameParts(characterNames) {
  return characterNames
    .flatMap(name => [name, ...String(name).split(/\s+/)])
    .map(normalize)
    .filter(part => part.length >= MIN_NAME_PART);
}

/**
 * D-006 guard: observable state must be unattributed. An entry that
 * mentions any character name (or name part) is dropped for players,
 * even if the mention looks harmless. Fails closed.
 */
function isUnattributed(entry, parts) {
  if (!entry || typeof entry !== 'object') return false;
  const text = normalize(`${entry.location ?? ''} ${entry.state ?? ''}`);
  return Boolean(entry.state) && !parts.some(part => text.includes(part));
}

/**
 * DM notes for a set of readers.
 *
 * - observable_world_state (D-006): visible to everyone, but only entries
 *   that name no character.
 * - every other list (D-004): an entry is kept only if EVERY reader
 *   appears in its known_by. Matching is exact (case-insensitive) and
 *   fails closed: untagged entries, old string-format entries and entries
 *   whose known_by doesn't name a reader are dropped.
 *
 * `readers === null` (the DM) gets everything.
 */
export function dmNotesFor(dmNotes, readers, characterNames = []) {
  if (!dmNotes || !readers) return dmNotes || null;

  const wanted = readers.map(normalize);
  const parts = nameParts([...characterNames, ...readers]);

  return Object.fromEntries(
    Object.entries(dmNotes).map(([field, value]) => {
      if (!Array.isArray(value)) return [field, []];

      const keep = field === OBSERVABLE_FIELD
        ? entry => isUnattributed(entry, parts)
        : entry => knownByAll(entry, wanted);

      return [field, value.filter(keep)];
    })
  );
}

/** The character_knowledge entries this audience may see. */
export function characterKnowledgeFor(characterKnowledge, audience) {
  const all = characterKnowledge || {};

  if (audience.kind === 'dm') return all;
  if (audience.kind === 'character') {
    return all[audience.name] ? { [audience.name]: all[audience.name] } : {};
  }
  return {};
}
