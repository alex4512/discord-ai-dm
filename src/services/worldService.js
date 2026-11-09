import { UserFacingError } from '../errors/UserFacingError.js';
import { amendActiveSnapshot } from './checkpointService.js';
import { REGISTRY_KINDS, appendChronicle, findKey, mergeSeed } from './registry.js';

/**
 * Adds DM-authored truth to an NPC or location (creating it if new) as a
 * new checkpoint version, so it is rolled back like everything else.
 * `kind` is a REGISTRY_KINDS key ('npcs' | 'locations').
 */
export async function addAuthorNote({ kind, guildId, userId, name, note }) {
  const label = REGISTRY_KINDS[kind].label;
  const entry = name.trim();
  const text = note.trim();

  if (!entry || !text) {
    throw new UserFacingError(`Usage: note <${label} name>: <text>`);
  }

  let key;
  const { version } = await amendActiveSnapshot({
    guildId,
    userId,
    reason: `${label} note: ${entry}`,
    mutate: snapshot => {
      snapshot[kind] = mergeSeed(kind, snapshot[kind], { [entry]: { author_notes: [text] } });
      key = findKey(snapshot[kind], entry);
      return snapshot;
    }
  });

  return { version, name: key };
}

/**
 * Imports a seed { npcs?: {...}, locations?: {...}, chronicle?: [...] } as
 * one new checkpoint version. Existing data is never overwritten: empty
 * fields are filled, facts/author notes/events appended (idempotent).
 */
export function importWorldSeed({ guildId, userId, seed, reason = 'world import' }) {
  return amendActiveSnapshot({
    guildId,
    userId,
    reason,
    mutate: snapshot => {
      for (const kind of Object.keys(REGISTRY_KINDS)) {
        if (seed[kind]) snapshot[kind] = mergeSeed(kind, snapshot[kind], seed[kind]);
      }
      if (seed.chronicle) {
        snapshot.chronicle = appendChronicle(snapshot.chronicle, seed.chronicle, 0);
      }
      return snapshot;
    }
  });
}
