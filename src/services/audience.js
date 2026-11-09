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

/**
 * DM notes for a set of readers (D-004): every list entry is kept only if
 * EVERY reader appears in its known_by. Matching is exact (case-insensitive)
 * and fails closed: untagged entries, old string-format entries and
 * entries whose known_by doesn't name a reader are dropped.
 * `readers === null` (the DM) gets everything.
 */
export function dmNotesFor(dmNotes, readers) {
  if (!dmNotes || !readers) return dmNotes || null;

  const wanted = readers.map(normalize);

  return Object.fromEntries(
    Object.entries(dmNotes).map(([field, value]) => [
      field,
      Array.isArray(value) ? value.filter(entry => knownByAll(entry, wanted)) : []
    ])
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
