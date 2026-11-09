import { randomInt } from 'node:crypto';

/**
 * Dice for monsters and NPCs (D-013). The DM model asks for rolls through a
 * tool; real random numbers come from here, never from the model.
 *
 * Expressions: terms joined by + or -, each a constant, NdM, or NdMkhK /
 * NdMklK (keep highest/lowest K: 2d20kh1 = advantage, 2d20kl1 = disadvantage).
 * Examples: "1d20+4", "2d6+2", "2d20kh1+5", "1d8+1d6+3".
 */

const MAX_DICE = 100;
const MAX_SIDES = 1000;
const TERM = /^(\d*)d(\d+)(?:(kh|kl)(\d+))?$/;

function parseTerms(expression) {
  const compact = String(expression).toLowerCase().replace(/\s+/g, '');
  if (!compact || !/^[-+]?[\dd+khl-]+$/.test(compact)) {
    throw new Error(`Invalid dice expression "${expression}"`);
  }

  const terms = [];
  for (const match of compact.matchAll(/([+-]?)([^+-]+)/g)) {
    const sign = match[1] === '-' ? -1 : 1;
    const body = match[2];

    if (/^\d+$/.test(body)) {
      terms.push({ sign, constant: Number(body) });
      continue;
    }

    const dice = body.match(TERM);
    if (!dice) throw new Error(`Invalid dice term "${body}"`);

    const count = Number(dice[1] || 1);
    const sides = Number(dice[2]);
    const keep = dice[3] ? { mode: dice[3], count: Number(dice[4]) } : null;

    if (count < 1 || count > MAX_DICE || sides < 2 || sides > MAX_SIDES) {
      throw new Error(`Dice out of range in "${body}"`);
    }
    if (keep && (keep.count < 1 || keep.count > count)) {
      throw new Error(`Invalid keep in "${body}"`);
    }

    terms.push({ sign, count, sides, keep, text: body });
  }

  if (!terms.length) throw new Error(`Invalid dice expression "${expression}"`);
  return terms;
}

/**
 * Rolls an expression. `random(min, maxExclusive)` is injectable for tests.
 * Returns { expression, total, detail } where detail shows every die,
 * e.g. "2d20kh1 [17, ~~4~~] + 5".
 */
export function rollDice(expression, random = randomInt) {
  const terms = parseTerms(expression);
  let total = 0;
  const parts = [];

  for (const term of terms) {
    const sign = term.sign < 0 ? '- ' : parts.length ? '+ ' : '';

    if (term.constant !== undefined) {
      total += term.sign * term.constant;
      parts.push(`${sign}${term.constant}`);
      continue;
    }

    const rolls = Array.from({ length: term.count }, () => random(1, term.sides + 1));
    let kept = rolls.map((value, index) => ({ value, index, kept: true }));

    if (term.keep) {
      const order = [...kept].sort((a, b) =>
        term.keep.mode === 'kh' ? b.value - a.value : a.value - b.value
      );
      const keepIndexes = new Set(order.slice(0, term.keep.count).map(r => r.index));
      kept = kept.map(r => ({ ...r, kept: keepIndexes.has(r.index) }));
    }

    const sum = kept.filter(r => r.kept).reduce((s, r) => s + r.value, 0);
    total += term.sign * sum;
    const shown = kept.map(r => (r.kept ? String(r.value) : `~~${r.value}~~`)).join(', ');
    parts.push(`${sign}${term.text} [${shown}]`);
  }

  return { expression: String(expression).trim(), total, detail: parts.join(' ') };
}

/** One visible line per roll, posted above the DM's narration. */
export function formatRoll({ label, detail, total, error }) {
  return error
    ? `🎲 ${label}: (could not roll: ${error})`
    : `🎲 ${label}: ${detail} = **${total}**`;
}
