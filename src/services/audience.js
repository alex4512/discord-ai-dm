import { config } from '../config.js';
import { REGISTRY_KINDS } from './registry.js';

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
