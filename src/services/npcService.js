import { UserFacingError } from '../errors/UserFacingError.js';
import { amendActiveSnapshot } from './checkpointService.js';
import { findNpcKey, mergeSeed } from './npcRegistry.js';

/**
 * Adds DM-authored truth about an NPC (creating the NPC if new) as a new
 * checkpoint version, so it is rolled back like everything else.
 */
export async function addAuthorNote({ guildId, userId, npcName, note }) {
  const name = npcName.trim();
  const text = note.trim();

  if (!name || !text) {
    throw new UserFacingError('Usage: /npc note <name>: <text>');
  }

  let key;
  const { version } = await amendActiveSnapshot({
    guildId,
    userId,
    reason: `npc note: ${name}`,
    mutate: snapshot => {
      snapshot.npcs = mergeSeed(snapshot.npcs, { [name]: { author_notes: [text] } });
      key = findNpcKey(snapshot.npcs, name);
      return snapshot;
    }
  });

  return { version, name: key };
}

/** Imports a seed { "<name>": record } as one new checkpoint version. */
export function importNpcSeed({ guildId, userId, seed, reason = 'npc import' }) {
  return amendActiveSnapshot({
    guildId,
    userId,
    reason,
    mutate: snapshot => {
      snapshot.npcs = mergeSeed(snapshot.npcs, seed);
      return snapshot;
    }
  });
}
