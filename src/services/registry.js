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
  },
  locations: {
    label: 'location',
    perceivable: ['description'],
    tagged: ['state']
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
 * - entries the model omitted are kept unchanged (never silently deleted),
 * - NPC memories are append-only (D-016): previous memories the model left
 *   out are kept, so an NPC never forgets.
 */
export function mergeUpdate(previous, updatedList) {
  const merged = { ...(previous || {}) };

  for (const entry of updatedList || []) {
    if (!entry?.name?.trim()) continue;
    const key = findKey(merged, entry.name) || entry.name.trim();
    const { author_notes: _ignored, ...fromModel } = entry;
    const before = merged[key];
    merged[key] = {
      ...fromModel,
      name: key,
      author_notes: before?.author_notes || []
    };
    if (before?.memories || fromModel.memories) {
      merged[key].memories = mergeMemories(before?.memories, fromModel.memories);
    }
  }

  return merged;
}

const memoryKey = m => `${normalize(m.with)}|${normalize(m.memory)}`;

/** Previous memories first (a re-sent copy may update `secret`), then new ones. */
function mergeMemories(previous = [], updated = []) {
  const valid = m => m && typeof m.memory === 'string' && m.memory.trim() && m.with;
  const byKey = new Map();
  for (const m of [...previous, ...updated].filter(valid)) {
    byKey.set(memoryKey(m), {
      with: String(m.with).trim(),
      memory: m.memory.trim(),
      secret: Boolean(m.secret)
    });
  }
  return [...byKey.values()];
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

/**
 * Appends new chronicle events (D-009). The chronicle is append-only:
 * previous entries are never changed; exact duplicates are skipped.
 */
export function appendChronicle(previous, events, version) {
  const existing = previous || [];
  const fresh = (events || [])
    .filter(e => e?.event?.trim())
    .map(e => ({
      event: e.event.trim(),
      location: (e.location || '').trim(),
      known_by: Array.isArray(e.known_by) ? e.known_by : [],
      version
    }))
    .filter(e => !existing.some(x => x.event === e.event && x.location === e.location));
  return [...existing, ...fresh];
}
