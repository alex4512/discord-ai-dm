// Pure helpers for registry partitions: named entities (NPCs, locations)
// with shared-perception fields, known_by-tagged values and facts, and
// DM-only author notes (docs/DECISIONS.md D-007). No I/O.

/**
 * Field layout per registry kind:
 * - perceivable: plain strings anyone meeting the entity perceives
 * - tagged: { value, known_by } fields
 */
export const REGISTRY_KINDS = Object.freeze({
  npcs: {
    label: 'NPC',
    perceivable: ['role', 'appearance', 'personality'],
    tagged: ['status', 'location']
  }
});

const normalize = name => String(name).trim().toLowerCase();

/** Existing registry key for `name` (case-insensitive), or null. */
export function findKey(entries, name) {
  const wanted = normalize(name);
  return Object.keys(entries || {}).find(key => normalize(key) === wanted) || null;
}

const sameJson = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const appendUnique = (list = [], extra = []) =>
  [...list, ...extra.filter(item => !list.some(existing => sameJson(existing, item)))];

export function emptyRecord(kind, name) {
  const { perceivable, tagged } = REGISTRY_KINDS[kind];
  return {
    name,
    ...Object.fromEntries(perceivable.map(field => [field, ''])),
    ...Object.fromEntries(tagged.map(field => [field, { value: '', known_by: [] }])),
    facts: [],
    author_notes: []
  };
}

/**
 * Applies the model's full list on top of the previous registry:
 * - author_notes are always carried over; the model cannot write them,
 * - entries the model omitted are kept unchanged (never silently deleted).
 */
export function mergeUpdate(previous, updatedList) {
  const merged = { ...(previous || {}) };

  for (const entry of updatedList || []) {
    if (!entry?.name?.trim()) continue;
    const key = findKey(merged, entry.name) || entry.name.trim();
    const { author_notes: _ignored, ...fromModel } = entry;
    merged[key] = {
      ...fromModel,
      name: key,
      author_notes: merged[key]?.author_notes || []
    };
  }

  return merged;
}

/**
 * Merges DM-authored seed records into the registry: fills empty fields,
 * appends new facts and author notes. Existing data is never overwritten.
 */
export function mergeSeed(kind, previous, seed) {
  const { perceivable, tagged } = REGISTRY_KINDS[kind];
  const merged = { ...(previous || {}) };

  for (const [name, record] of Object.entries(seed)) {
    const key = findKey(merged, name) || name.trim();
    const current = merged[key] || emptyRecord(kind, key);
    const next = { ...current, name: key };

    for (const field of perceivable) {
      next[field] = current[field] || record[field] || '';
    }
    for (const field of tagged) {
      next[field] = current[field]?.value ? current[field] : (record[field] || current[field]);
    }
    next.facts = appendUnique(current.facts, record.facts);
    next.author_notes = appendUnique(current.author_notes, record.author_notes);

    merged[key] = next;
  }

  return merged;
}
