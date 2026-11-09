// Pure helpers for the NPC registry partition (D-007). No I/O.

const normalize = name => String(name).trim().toLowerCase();

/** Existing registry key for `name` (case-insensitive), or null. */
export function findNpcKey(npcs, name) {
  const wanted = normalize(name);
  return Object.keys(npcs || {}).find(key => normalize(key) === wanted) || null;
}

const sameJson = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const appendUnique = (list = [], extra = []) =>
  [...list, ...extra.filter(item => !list.some(existing => sameJson(existing, item)))];

/**
 * Applies the model's full NPC list on top of the previous registry (D-007):
 * - author_notes are always carried over from the previous registry; the
 *   model cannot write them,
 * - NPCs the model omitted are kept unchanged (never silently deleted).
 */
export function mergeNpcUpdate(previous, updatedList) {
  const merged = { ...(previous || {}) };

  for (const npc of updatedList || []) {
    if (!npc?.name?.trim()) continue;
    const key = findNpcKey(merged, npc.name) || npc.name.trim();
    merged[key] = {
      ...npc,
      name: key,
      author_notes: merged[key]?.author_notes || []
    };
  }

  return merged;
}

export const EMPTY_NPC = name => ({
  name,
  role: '',
  appearance: '',
  personality: '',
  status: { value: '', known_by: [] },
  location: { value: '', known_by: [] },
  facts: [],
  author_notes: []
});

/**
 * Merges DM-authored seed records into the registry: fills empty fields,
 * appends new facts and author notes. Existing data is never overwritten.
 */
export function mergeSeed(previous, seed) {
  const merged = { ...(previous || {}) };

  for (const [name, record] of Object.entries(seed)) {
    const key = findNpcKey(merged, name) || name.trim();
    const current = merged[key] || EMPTY_NPC(key);
    const fill = field => current[field] || record[field] || '';
    const fillTagged = field =>
      current[field]?.value ? current[field] : (record[field] || current[field]);

    merged[key] = {
      ...current,
      name: key,
      role: fill('role'),
      appearance: fill('appearance'),
      personality: fill('personality'),
      status: fillTagged('status'),
      location: fillTagged('location'),
      facts: appendUnique(current.facts, record.facts),
      author_notes: appendUnique(current.author_notes, record.author_notes)
    };
  }

  return merged;
}
