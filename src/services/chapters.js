// Chapter summaries of old chronicle events (D-033).
//
// The chronicle is append-only and never shortened. Once it grows past
// COMPACT_THRESHOLD uncovered events, the oldest are summarized into
// chapters and only the newest KEEP_RECENT stay in full on play turns.
// Each chapter covers events with exactly one known_by set, so a chapter is
// readable by the same characters as the events it replaces.

import { generateChapter } from '../ai/dungeonMaster.js';

export const COMPACT_THRESHOLD = 250;
export const KEEP_RECENT = 150;
const EVENTS_PER_CHAPTER = 32;

const norm = name => String(name).trim().toLowerCase();
const knownByOf = entry => (Array.isArray(entry?.known_by) ? entry.known_by : []);
const groupKey = entry => knownByOf(entry).map(norm).sort().join('|');

export const emptyChapters = () => ({ through: 0, list: [] });

function knownByAll(knownBy, readers) {
  const set = knownBy.map(norm);
  return readers.every(reader => set.includes(norm(reader)));
}

/** Chapters these readers may read, oldest first. `readers === null` = DM. */
export function chaptersFor(chapters, readers) {
  const list = Array.isArray(chapters?.list) ? chapters.list : [];
  return list
    .filter(ch => !readers || knownByAll(knownByOf(ch), readers))
    .sort((a, b) => a.from - b.from);
}

/** Chronicle entries not covered by chapters (the ones turns show in full). */
export function uncoveredChronicle(chronicle, chapters) {
  const all = Array.isArray(chronicle) ? chronicle : [];
  return all.slice(Math.min(chapters?.through || 0, all.length));
}

/**
 * Which events to summarize now. Returns null when nothing is due, else
 * { through, chunks: [{ known_by, from, to, events }] }. `force` compacts
 * whatever lies beyond KEEP_RECENT even below the threshold.
 */
export function planCompaction(chronicle, chapters, { force = false, keep = KEEP_RECENT } = {}) {
  const all = Array.isArray(chronicle) ? chronicle : [];
  const start = Math.min(chapters?.through || 0, all.length);
  const uncovered = all.length - start;
  if (!force && uncovered <= COMPACT_THRESHOLD) return null;

  const through = all.length - keep;
  if (through <= start) return null;

  const groups = new Map();
  for (let i = start; i < through; i++) {
    const key = groupKey(all[i]);
    if (!groups.has(key)) groups.set(key, { known_by: knownByOf(all[i]), items: [] });
    groups.get(key).items.push({ index: i, entry: all[i] });
  }

  const chunks = [];
  for (const { known_by, items } of groups.values()) {
    const count = Math.max(1, Math.round(items.length / EVENTS_PER_CHAPTER));
    const size = Math.ceil(items.length / count);
    for (let c = 0; c < items.length; c += size) {
      const part = items.slice(c, c + size);
      chunks.push({
        known_by,
        from: part[0].index,
        to: part[part.length - 1].index,
        events: part.map(({ entry }) => ({ event: entry.event, location: entry.location || null }))
      });
    }
  }
  return { through, chunks };
}

/**
 * Writes the planned chapters (one model call each, in parallel) and returns
 * the new chapters partition. Throws if any call fails; callers keep the
 * old partition then.
 */
export async function writeChapters(chapters, plan) {
  const written = await Promise.all(plan.chunks.map(async chunk => {
    const { title, summary } = await generateChapter({ events: chunk.events });
    return { title, summary, known_by: chunk.known_by, from: chunk.from, to: chunk.to };
  }));
  return {
    through: plan.through,
    list: [...(chapters?.list || []), ...written].sort((a, b) => a.from - b.from)
  };
}

/** Compacts if due. Never throws: on failure the old chapters are kept. */
export async function compactIfDue(chapters, chronicle) {
  const current = chapters || emptyChapters();
  const plan = planCompaction(chronicle, current);
  if (!plan) return current;
  try {
    const next = await writeChapters(current, plan);
    console.log(`[chapters] ${plan.chunks.length} chapters written, events [0, ${plan.through}) covered`);
    return next;
  } catch (error) {
    console.error('[chapters] compaction failed, keeping old chapters:', error.message);
    return current;
  }
}

/** Chapters whose readers include `teller` become known by `listeners` too (D-031). */
export function shareChapters(chapters, teller, listeners) {
  const current = chapters || emptyChapters();
  return {
    ...current,
    list: (current.list || []).map(ch => {
      const knownBy = knownByOf(ch);
      if (!knownBy.map(norm).includes(norm(teller))) return ch;
      const missing = listeners.filter(n => !knownBy.map(norm).includes(norm(n)));
      return missing.length ? { ...ch, known_by: [...knownBy, ...missing] } : ch;
    })
  };
}
