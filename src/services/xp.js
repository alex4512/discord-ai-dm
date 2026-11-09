/**
 * Experience awards (D-012). The DM marks a resolved encounter with a hidden
 * tag; the code computes XP from the 5e (2014) CR table and splits it
 * evenly. Totals are kept by the players in Avrae (`!cc XP +N`), which our
 * bot cannot command (Avrae ignores bots), so nothing is stored here.
 *
 * Tag: [[XP: 4 goblin CR 1/4; 1 bugbear CR 1 | Kraavok, Looming Shade]]
 * A plain amount is a direct award: [[XP: 150 solved the seal | Kraavok]]
 */

// Monster Manual (2014), XP by challenge rating. CR 0 counted as 10.
const XP_BY_CR = {
  '0': 10, '1/8': 25, '1/4': 50, '1/2': 100,
  '1': 200, '2': 450, '3': 700, '4': 1100, '5': 1800,
  '6': 2300, '7': 2900, '8': 3900, '9': 5000, '10': 5900,
  '11': 7200, '12': 8400, '13': 10000, '14': 11500, '15': 13000,
  '16': 15000, '17': 18000, '18': 20000, '19': 22000, '20': 25000,
  '21': 33000, '22': 41000, '23': 50000, '24': 62000, '25': 75000,
  '26': 90000, '27': 105000, '28': 120000, '29': 135000, '30': 155000
};

const DECIMAL_CR = { '0.125': '1/8', '0.25': '1/4', '0.5': '1/2' };

export const XP_TAG = /\[\[\s*XP\s*:\s*([^\]\n]+?)\s*\]\]/gi;

const MONSTER = /^(\d+)\s*[x×]?\s+(.+?)\s*\(?\s*CR\s*([\d./]+)\s*\)?$/i;
const DIRECT = /^(\d+)\s*(?:xp\b)?\s*(.*)$/i;

function xpForCr(cr) {
  const key = DECIMAL_CR[cr] || cr.replace(/^0+(?=\d)/, '');
  return XP_BY_CR[key] ?? null;
}

/**
 * Parses one tag body against the registered character names.
 * Returns null if nothing valid remains (unknown CR, no participants).
 */
export function parseXpTag(body, characterNames) {
  const [left, right = ''] = String(body).split('|');

  const byName = new Map(characterNames.map(n => [n.trim().toLowerCase(), n]));
  const participants = [...new Set(
    right.split(',')
      .map(n => byName.get(n.trim().toLowerCase()))
      .filter(Boolean)
  )];

  const sources = [];
  for (const raw of left.split(';').map(s => s.trim()).filter(Boolean)) {
    const monster = raw.match(MONSTER);
    if (monster) {
      const [, count, creature, cr] = monster;
      const each = xpForCr(cr);
      if (each == null) continue;
      sources.push({
        label: `${count} ${creature.trim()} (CR ${DECIMAL_CR[cr] || cr})`,
        xp: Number(count) * each
      });
      continue;
    }
    const direct = raw.match(DIRECT);
    if (direct) {
      sources.push({ label: direct[2].trim() || 'award', xp: Number(direct[1]) });
    }
  }

  const total = sources.reduce((sum, s) => sum + s.xp, 0);
  if (!participants.length || total <= 0) return null;

  return {
    sources,
    total,
    participants,
    each: Math.floor(total / participants.length)
  };
}

/** Removes XP tags from a reply; returns the clean text and parsed awards. */
export function extractXpTags(text, characterNames) {
  const awards = [...String(text).matchAll(XP_TAG)]
    .map(match => parseXpTag(match[1], characterNames))
    .filter(Boolean);

  const clean = String(text).replace(XP_TAG, '').replace(/\n{3,}/g, '\n\n').trim();
  return { text: clean, awards };
}

/** The line players see, with the Avrae command to copy. */
export function formatXpAward(award) {
  const what = award.sources.map(s => s.label).join(', ');
  const who = award.participants.join(', ');
  return (
    `**XP:** ${what} = ${award.total} XP → **+${award.each} each** (${who}).\n` +
    `Avrae: \`!cc XP +${award.each}\``
  );
}

/** Short plain note appended to the stored DM reply, for the next save. */
export function xpHistoryNote(award) {
  return (
    `(XP awarded: +${award.each} each to ${award.participants.join(', ')}; ` +
    `${award.sources.map(s => s.label).join(', ')}.)`
  );
}
