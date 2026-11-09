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

/**
 * DM notes for a set of readers (D-004): a secret is kept only if EVERY
 * reader already knows it. Matching is exact (case-insensitive) and fails
 * closed: a secret whose known_by doesn't name a reader is dropped.
 */
export function dmNotesFor(dmNotes, readers) {
  if (!dmNotes || !readers) return dmNotes || null;

  const wanted = readers.map(normalize);

  return {
    ...dmNotes,
    secrets: (dmNotes.secrets || []).filter(secret => {
      const knownBy = (secret.known_by || []).map(normalize);
      return wanted.every(reader => knownBy.includes(reader));
    })
  };
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
