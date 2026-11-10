import { UserFacingError } from '../errors/UserFacingError.js';
import { amendActiveSnapshot, getActiveCheckpoint } from './checkpointService.js';
import { REGISTRY_KINDS, appendChronicle, findKey, mergeSeed } from './registry.js';
import { planCompaction, shareChapters, writeChapters } from './chapters.js';

/**
 * `/chronicle compact` (D-033): summarizes everything but the newest
 * KEEP_RECENT events now, below the automatic threshold. The model calls run
 * first; the new version is written only if the chronicle and chapters did
 * not change meanwhile. Returns { version, chapters } or null if nothing to do.
 */
export async function compactChronicleNow({ guildId, userId }) {
  const state = await getActiveCheckpoint(guildId);
  if (!state) throw new UserFacingError('Save a first checkpoint first.');
  const plan = planCompaction(state.chronicle, state.chapters, { force: true });
  if (!plan) return null;

  const next = await writeChapters(state.chapters, plan);
  const { version } = await amendActiveSnapshot({
    guildId,
    userId,
    reason: `chronicle compacted into ${plan.chunks.length} chapters`,
    mutate: snapshot => {
      if (snapshot.chronicle.length !== state.chronicle.length ||
          (snapshot.chapters?.through || 0) !== (state.chapters?.through || 0)) {
        throw new UserFacingError('The chronicle changed while compacting (a save?). Try again.');
      }
      snapshot.chapters = next;
      return snapshot;
    }
  });
  return { version, chapters: plan.chunks.length, through: plan.through };
}

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
 * A character told the group everything they know (/story in main, D-031):
 * every chronicle event `teller` knows becomes known by `listeners` too, as
 * a new checkpoint version (undoable). Returns { version, shared }.
 */
export async function shareChronicle({ guildId, userId, teller, listeners }) {
  const norm = n => String(n).trim().toLowerCase();
  let shared = 0;
  const { version } = await amendActiveSnapshot({
    guildId,
    userId,
    reason: `${teller} told the group the story so far`,
    mutate: snapshot => {
      snapshot.chronicle = (snapshot.chronicle || []).map(entry => {
        const knownBy = Array.isArray(entry?.known_by) ? entry.known_by : [];
        if (!knownBy.map(norm).includes(norm(teller))) return entry;
        const missing = listeners.filter(n => !knownBy.map(norm).includes(norm(n)));
        if (!missing.length) return entry;
        shared++;
        return { ...entry, known_by: [...knownBy, ...missing] };
      });
      // Chapters summarizing those events are shared the same way (D-033).
      snapshot.chapters = shareChapters(snapshot.chapters, teller, listeners);
      return snapshot;
    }
  });
  return { version, shared };
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
