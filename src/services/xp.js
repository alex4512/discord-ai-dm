/**
 * Experience awards (D-012). The DM marks a resolved encounter with a hidden
 * tag; the code computes XP from the 5e (2014) CR table and splits it
 * evenly. Totals are kept by the bot (progressService.js, D-014).
 *
 * Tag: [[XP: 4 goblin CR 1/4; 1 bugbear CR 1 | Kraavok, Looming Shade]]
 * Challenge or milestone, priced by level: [[XP: medium challenge: disarmed the trap | Kraavok]]
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

// Dungeon Master's Guide (2014), XP thresholds per character level
// [easy, medium, hard, deadly]. A non-combat challenge or story milestone is
// worth an encounter of the same difficulty (D-015).
const THRESHOLDS = [
  null,
  [25, 50, 75, 100], [50, 100, 150, 200], [75, 150, 225, 400],
  [125, 250, 375, 500], [250, 500, 750, 1100], [300, 600, 900, 1400],
  [350, 750, 1100, 1700], [450, 900, 1400, 2100], [550, 1100, 1600, 2400],
  [600, 1200, 1900, 2800], [800, 1600, 2400, 3600], [1000, 2000, 3000, 4500],
  [1100, 2200, 3400, 5100], [1250, 2500, 3800, 5700], [1400, 2800, 4300, 6400],
  [1600, 3200, 4800, 7200], [2000, 3900, 5900, 8800], [2100, 4200, 6300, 9500],
  [2400, 4900, 7300, 10900], [2800, 5700, 8500, 12700]
];
const DIFFICULTY = { easy: 0, medium: 1, hard: 2, deadly: 3 };

const MONSTER = /^(\d+)\s*[x×]?\s+(.+?)\s*\(?\s*CR\s*([\d./]+)\s*\)?$/i;
const CHALLENGE = /^(easy|medium|hard|deadly)(?:\s+(?:challenge|milestone))?\s*[:\-–]?\s*(.*)$/i;
const DIRECT = /^(\d+)\s*(?:xp\b)?\s*(.*)$/i;

function xpForCr(cr) {
  const key = DECIMAL_CR[cr] || cr.replace(/^0+(?=\d)/, '');
  return XP_BY_CR[key] ?? null;
}

/** Sum of the participants' thresholds for a difficulty (each by their level). */
function challengeXp(difficulty, participants, levels) {
  const column = DIFFICULTY[difficulty.toLowerCase()];
  return participants.reduce((sum, name) => {
    const level = Math.min(Math.max(Number(levels?.[name]) || 1, 1), 20);
    return sum + THRESHOLDS[level][column];
  }, 0);
}

/**
 * Parses one tag body against the registered character names. `levels`
 * ({ name: level }) prices challenges; unknown levels count as 1.
 * Returns null if nothing valid remains (unknown CR, no participants).
 */
export function parseXpTag(body, characterNames, levels = {}) {
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
    const challenge = raw.match(CHALLENGE);
    if (challenge) {
      const [, difficulty, what] = challenge;
      sources.push({
        label: `${what.trim() || 'challenge'} (${difficulty.toLowerCase()})`,
        xp: challengeXp(difficulty, participants, levels)
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
export function extractXpTags(text, characterNames, levels = {}) {
  const awards = [...String(text).matchAll(XP_TAG)]
    .map(match => parseXpTag(match[1], characterNames, levels))
    .filter(Boolean);

  const clean = String(text).replace(XP_TAG, '').replace(/\n{3,}/g, '\n\n').trim();
  return { text: clean, awards };
}

/** The award line players see in the channel (no totals; D-014). */
export function formatXpAward(award) {
  const what = award.sources.map(s => s.label).join(', ');
  const who = award.participants.join(', ');
  return `**XP:** ${what} = ${award.total} XP → **+${award.each} each** (${who}).`;
}

/** Award entries for the ledger: one per participant. */
export function awardEntries(award) {
  const reason = award.sources.map(s => s.label).join(', ');
  return award.participants.map(characterName => ({
    characterName,
    amount: award.each,
    reason
  }));
}

/** Short plain note appended to the stored DM reply, for the next save. */
export function xpHistoryNote(award) {
  return (
    `(XP awarded: +${award.each} each to ${award.participants.join(', ')}; ` +
    `${award.sources.map(s => s.label).join(', ')}.)`
  );
}
