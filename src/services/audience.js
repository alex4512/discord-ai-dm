import { config } from '../config.js';
import { REGISTRY_KINDS } from './registry.js';
import { isPrivateChannel } from './roster.js';

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

  if (isPrivateChannel(channelId)) {
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

/**
 * A registry partition (NPCs, locations) for a set of readers (D-007).
 *
 * - perceivable fields (e.g. role, appearance): shared perception; dropped
 *   if they mention a player character (same fail-closed guard as D-006).
 * - tagged fields (e.g. status) and facts: only if EVERY reader is in
 *   known_by.
 * - author_notes (DM-authored truth): only when `includeAuthorNotes`,
 *   i.e. in DM reply prompts, never in summarization inputs or player views.
 * - An entry is part of a player audience's world only once every reader
 *   knows something about it (a tagged value or a fact). Unknown entries,
 *   and their author notes, are left out entirely (D-007 revision).
 *
 * `readers === null` (the DM) gets the raw registry.
 */
export function registryFor(kind, entries, readers, characterNames = [], { includeAuthorNotes = false } = {}) {
  if (!entries) return {};
  if (!readers) return entries;

  const { perceivable, tagged } = REGISTRY_KINDS[kind];
  const wanted = readers.map(normalize);
  const parts = nameParts([...characterNames, ...readers]);
  const perceived = text =>
    typeof text === 'string' && !parts.some(part => normalize(text).includes(part))
      ? text
      : '';
  const ifKnown = value => (knownByAll(value, wanted) ? value.value : null);

  const views = Object.entries(entries).map(([key, entry]) => {
    const view = { name: entry.name || key };
    for (const field of perceivable) view[field] = perceived(entry[field]);
    for (const field of tagged) view[field] = ifKnown(entry[field]);
    view.facts = (entry.facts || [])
      .filter(fact => knownByAll(fact, wanted))
      .map(fact => fact.fact);
    if (includeAuthorNotes) view.author_notes = entry.author_notes || [];
    return [key, view];
  });

  return Object.fromEntries(
    views.filter(([, view]) => tagged.some(field => view[field]) || view.facts.length)
  );
}

/** NPC registry for a set of readers (D-007). */
export const npcsFor = (npcs, readers, characterNames, options) =>
  registryFor('npcs', npcs, readers, characterNames, options);

/** Location registry for a set of readers (D-009); same rules as NPCs. */
export const locationsFor = (locations, readers, characterNames, options) =>
  registryFor('locations', locations, readers, characterNames, options);

// Titles that must not on their own make an NPC "appear in the scene".
const TITLE_WORDS = new Set([
  'brother', 'sister', 'mother', 'father', 'captain', 'lord', 'lady',
  'master', 'mistress', 'sergeant', 'old', 'young', 'the'
]);
export const NPC_MEMORIES_PER_CHARACTER = 8;

// Shorter than the name guard above: a false match only adds context.
const MIN_MENTION_PART = 3;

function mentions(text, name) {
  const words = String(name).toLowerCase().split(/\s+/)
    .filter(w => w.length >= MIN_MENTION_PART && !TITLE_WORDS.has(w));
  const needles = [String(name).toLowerCase(), ...words];
  return needles.some(n => new RegExp(`(^|[^\\p{L}])${n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}($|[^\\p{L}])`, 'iu').test(text));
}

/**
 * Keeps only registry entries mentioned in `sceneText` (D-017): a DM reply
 * gets the NPCs and places of the current scene, not the whole registry.
 */
export function mentionedIn(entries, sceneText) {
  const text = String(sceneText || '');
  return Object.fromEntries(
    Object.entries(entries || {}).filter(([key, entry]) => mentions(text, entry?.name || key))
  );
}

/**
 * NPC memories for a DM reply prompt (D-016): for each NPC mentioned in
 * `sceneText` (current message, recent history, scene), what it remembers
 * about the characters reading this channel.
 *
 * - private channel: memories with its character, secret ones included
 *   (the NPC is alone with them);
 * - shared channel: non-secret memories with any reader. The NPC may raise
 *   them in front of others, as a person would; secrets are left out
 *   entirely (fail closed);
 * - #dm-testing (readers null): every memory of the mentioned NPCs.
 */
export function npcMemoriesFor(npcs, audience, readers, sceneText) {
  const text = String(sceneText || '');
  const wanted = readers ? readers.map(normalize) : null;
  const alone = audience.kind === 'character';
  const result = {};

  for (const [key, npc] of Object.entries(npcs || {})) {
    if (!Array.isArray(npc.memories) || !npc.memories.length) continue;
    if (!mentions(text, npc.name || key)) continue;

    const visible = npc.memories.filter(m =>
      (!wanted || wanted.includes(normalize(m.with))) &&
      (!m.secret || alone || !wanted)
    );

    // Most recent few per character.
    const perCharacter = {};
    for (const m of visible) (perCharacter[m.with] ||= []).push(m);
    const kept = Object.values(perCharacter)
      .flatMap(list => list.slice(-NPC_MEMORIES_PER_CHARACTER));

    if (kept.length) {
      result[npc.name || key] = kept.map(m => ({
        with: m.with,
        memory: m.memory,
        ...(m.secret ? { secret: true } : {})
      }));
    }
  }

  return result;
}

export const CHRONICLE_PROMPT_LIMIT = 30;

/**
 * Play turns see (almost) the whole chronicle, so the DM remembers the
 * early campaign (D-032). Saves keep CHRONICLE_PROMPT_LIMIT. Past this cap
 * the oldest events drop out; by then old events should be compacted.
 */
export const TURN_CHRONICLE_LIMIT = 400;

/**
 * Chronicle entries a set of readers may know (D-009): an event is kept
 * only if EVERY reader is in its known_by (fail closed). Most recent
 * `limit` entries, oldest first. `readers === null` (the DM) gets all.
 */
export function chronicleFor(chronicle, readers, { limit = CHRONICLE_PROMPT_LIMIT } = {}) {
  const all = Array.isArray(chronicle) ? chronicle : [];
  const visible = readers
    ? all.filter(entry => knownByAll(entry, readers.map(normalize)))
    : all;
  return limit ? visible.slice(-limit) : visible;
}
