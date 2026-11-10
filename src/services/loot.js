/**
 * Loot and inventory (D-022). Pure helpers: tag parsing, validation against
 * what is held, per-audience views and the lines players see.
 *
 * The DM ends a reply with a hidden tag when items change hands:
 *   [[LOOT: +2 healing potion; +35 gp]]                 -> party (default)
 *   [[LOOT: +1 silver dagger -> Kraavok]]               -> Kraavok, explicitly
 *   [[LOOT: -1 healing potion from Kraavok (drank it)]] -> removed
 *   [[LOOT: 1 rope: party -> Looming Shade]]            -> moved
 *
 * Inventory shape (the `inventory` partition):
 *   { party: { key: { name, qty } },
 *     characters: { Name: { key: { name, qty, secret } } } }
 *
 * A personal item is secret when it was gained in a private channel: only
 * that character and #dm-testing see it. Party items are always shared.
 */

export const LOOT_TAG = /\[\[\s*LOOT\s*:\s*([^\]\n]+?)\s*\]\]/gi;

export const PARTY = 'party';
const PARTY_WORDS = new Set(['party', 'the party', 'group', 'common', 'shared', 'everyone']);
const ARTICLE = /^(?:a|an|the|some)\s+/i;

export const emptyInventory = () => ({ party: {}, characters: {} });

/** Normalized item name used as key: lowercase, single spaces, no article. */
export const itemKey = name =>
  String(name).trim().toLowerCase().replace(ARTICLE, '').replace(/\s+/g, ' ');

/** Deep copy with both maps present. */
export function cloneInventory(inventory) {
  const inv = inventory || {};
  return {
    party: Object.fromEntries(
      Object.entries(inv.party || {}).map(([k, v]) => [k, { ...v }])
    ),
    characters: Object.fromEntries(
      Object.entries(inv.characters || {}).map(([name, bag]) => [
        name,
        Object.fromEntries(Object.entries(bag || {}).map(([k, v]) => [k, { ...v }]))
      ])
    )
  };
}

const bagOf = (inv, holder) =>
  holder === PARTY ? inv.party : (inv.characters[holder] ||= {});

/**
 * The key under which `item` is held in a bag, tolerating plural/singular
 * and articles ("potions" vs "potion"). null if not held.
 */
export function findHeld(bag, item) {
  const key = itemKey(item);
  const variants = [key, key.replace(/e?s$/, ''), `${key}s`, `${key}es`];
  return variants.find(v => bag?.[v]?.qty > 0) || null;
}

/** 'party', a registered character name, or null (unknown). */
export function resolveHolder(raw, characterNames) {
  const text = String(raw || '').trim().toLowerCase();
  if (!text) return null;
  if (PARTY_WORDS.has(text)) return PARTY;

  const exact = characterNames.find(n => n.toLowerCase() === text);
  if (exact) return exact;

  // First name alone ("Looming"), only when unambiguous.
  const partial = characterNames.filter(n => n.toLowerCase().split(/\s+/)[0] === text);
  return partial.length === 1 ? partial[0] : null;
}

const QTY_ITEM = /^(\d+)?\s*[x×]?\s*(.+)$/i;

function quantityAndItem(text) {
  const match = String(text).trim().match(QTY_ITEM);
  if (!match) return null;
  const qty = match[1] ? Number(match[1]) : 1;
  const item = match[2].trim().replace(ARTICLE, '');
  return qty > 0 && item ? { qty, item } : null;
}

/** Splits a trailing "(reason)"; "secret" in it marks the change secret. */
function splitReason(text) {
  const match = text.match(/\s*\(([^)]*)\)\s*$/);
  if (!match) return { body: text.trim(), reason: '', secret: false };
  const reason = match[1].trim();
  return {
    body: text.slice(0, match.index).trim(),
    reason: reason.replace(/\bsecret\b/i, '').replace(/^[\s,;:-]+|[\s,;:-]+$/g, ''),
    secret: /\bsecret\b/i.test(reason)
  };
}

/**
 * Parses one tag body into operations. Holders are left null when the tag
 * doesn't name one; the caller fills in the channel's default.
 * Returns { ops: [{ type, qty, item, from, to, reason, secret, text }], invalid: [text] }.
 */
export function parseLootTag(body, characterNames) {
  const ops = [];
  const invalid = [];

  for (const raw of String(body).split(';').map(s => s.trim()).filter(Boolean)) {
    const { body: text, reason, secret } = splitReason(raw);
    let op = null;

    const move = text.match(/^(.+?)\s*:\s*(.+?)\s*->\s*(.+)$/);
    const gain = text.match(/^\+\s*(.+?)(?:\s*->\s*(.+))?$/);
    const loss = text.match(/^-\s*(.+)$/);

    if (move) {
      const what = quantityAndItem(move[1]);
      const from = resolveHolder(move[2], characterNames);
      const to = resolveHolder(move[3], characterNames);
      if (what && from && to && from !== to) op = { type: 'move', ...what, from, to };
    } else if (gain) {
      const what = quantityAndItem(gain[1]);
      const to = gain[2] === undefined ? null : resolveHolder(gain[2], characterNames);
      if (what && (gain[2] === undefined || to)) op = { type: 'gain', ...what, from: null, to };
    } else if (loss) {
      // "from <holder>" only counts when it names a holder ("letter from
      // Orren" is an item).
      const fromMatch = loss[1].match(/^(.+?)\s+from\s+(.+)$/i);
      const from = fromMatch ? resolveHolder(fromMatch[2], characterNames) : null;
      const what = quantityAndItem(from ? fromMatch[1] : loss[1]);
      if (what) op = { type: 'loss', ...what, from, to: null };
    }

    if (op) ops.push({ ...op, reason, secret, text: raw });
    else invalid.push(raw);
  }

  return { ops, invalid };
}

/** Removes loot tags from a reply; returns the clean text and parsed tags. */
export function extractLootTags(text, characterNames) {
  const tags = [...String(text).matchAll(LOOT_TAG)]
    .map(match => parseLootTag(match[1], characterNames));
  const clean = String(text).replace(LOOT_TAG, '').replace(/\n{3,}/g, '\n\n').trim();
  return {
    text: clean,
    ops: tags.flatMap(t => t.ops),
    invalid: tags.flatMap(t => t.invalid)
  };
}

/** Applies ledger events ({ holder, item, itemKey, delta, secret }) in order. */
export function applyEvents(inventory, events) {
  const inv = cloneInventory(inventory);
  for (const e of events) {
    const bag = bagOf(inv, e.holder);
    const entry = (bag[e.itemKey] ||= { name: e.item, qty: 0 });
    if (e.holder !== PARTY) {
      // Secret until gained in the open once.
      entry.secret = entry.qty === 0 ? Boolean(e.secret) : entry.secret && Boolean(e.secret || e.delta < 0);
    }
    entry.qty += e.delta;
    if (entry.qty <= 0) delete bag[e.itemKey];
  }
  for (const [name, bag] of Object.entries(inv.characters)) {
    if (!Object.keys(bag).length) delete inv.characters[name];
  }
  return inv;
}

const where = holder => (holder === PARTY ? 'the party' : holder);

/**
 * Turns parsed operations into ledger events for one channel, checked
 * against the current inventory (sequentially, so one tag can't spend the
 * same potion twice).
 *
 * context:
 *   kind: 'shared' | 'character' | 'dm'  (the channel's audience)
 *   characterName: the private channel's character (kind 'character')
 *
 * Rules:
 *   - shared channel: default holder is the party; nothing is secret.
 *   - private channel: only that character's own items. Default holder is
 *     the character, and what they gain is secret. Changes to the party or
 *     another character are refused there (the others would learn of it);
 *     they happen in #main-adventure.
 *   - #dm-testing: default holder is the party; "(secret)" honoured.
 *
 * Returns { events, applied: [op], refused: [{ op, why }] }.
 */
export function planLoot(ops, inventory, context) {
  const inv = cloneInventory(inventory);
  const events = [];
  const applied = [];
  const refused = [];
  const own = context.kind === 'character' ? context.characterName : null;
  const fallback = own || PARTY;

  for (const op of ops) {
    const from = op.type === 'gain' ? null : (op.from || fallback);
    const to = op.type === 'loss' ? null : (op.to || fallback);

    if (own && [from, to].some(h => h && h !== own)) {
      refused.push({ op, why: 'only your own items change here; share loot in #main-adventure' });
      continue;
    }

    const secret = own ? true : context.kind === 'dm' ? op.secret : false;
    const step = [];

    if (from) {
      const key = findHeld(bagOf(inv, from), op.item);
      const held = key ? bagOf(inv, from)[key].qty : 0;
      if (held < op.qty) {
        refused.push({ op, why: `${where(from)} has ${held ? `only ${held}` : 'none'}` });
        continue;
      }
      step.push({ holder: from, item: bagOf(inv, from)[key].name, itemKey: key, delta: -op.qty, secret });
    }
    if (to) {
      // Add to an existing stack of the same thing when there is one.
      const key = findHeld(bagOf(inv, to), op.item) || itemKey(op.item);
      const name = bagOf(inv, to)[key]?.name || (step[0]?.item ?? op.item);
      step.push({ holder: to, item: name, itemKey: key, delta: op.qty, secret: to === PARTY ? false : secret });
    }

    const reason = op.reason || (op.type === 'move' ? `${where(from)} -> ${where(to)}` : '');
    const done = step.map(e => ({ ...e, reason }));
    Object.assign(inv, applyEvents(inv, done));
    events.push(...done);
    applied.push({ ...op, from, to });
  }

  return { events, applied, refused };
}

/**
 * What one audience may see (D-022): the party's items always; a
 * character's own items in their private channel; other characters' items
 * only when not secret. #dm-testing (kind 'dm') sees everything.
 */
export function inventoryFor(inventory, audience) {
  const inv = cloneInventory(inventory);
  if (audience.kind === 'dm') return inv;

  const characters = {};
  for (const [name, bag] of Object.entries(inv.characters)) {
    const mine = audience.kind === 'character' && audience.name === name;
    const visible = Object.fromEntries(
      Object.entries(bag).filter(([, entry]) => mine || !entry.secret)
    );
    if (Object.keys(visible).length) characters[name] = visible;
  }
  return { party: inv.party, characters };
}

const COINS = new Set(['cp', 'sp', 'ep', 'gp', 'pp']);
const entryText = e => (COINS.has(itemKey(e.name)) ? `${e.qty} ${e.name}` : `${e.qty} × ${e.name}`);

/** Compact view for prompts: { party: ["2 × healing potion"], Kraavok: [...] }. */
export function inventoryPromptView(view) {
  const list = bag => Object.values(bag || {}).map(e => `${entryText(e)}${e.secret ? ' (secret)' : ''}`);
  return {
    party: list(view.party),
    ...Object.fromEntries(Object.entries(view.characters || {}).map(([n, bag]) => [n, list(bag)]))
  };
}

/** `/inventory` text for a view. */
export function formatInventory(view) {
  const lines = ['**🎒 Party**', ...Object.values(view.party || {}).map(e => `- ${entryText(e)}`)];
  if (lines.length === 1) lines.push('- (nothing yet)');
  for (const [name, bag] of Object.entries(view.characters || {})) {
    lines.push(`**${name}**`);
    for (const e of Object.values(bag)) lines.push(`- ${entryText(e)}${e.secret ? ' *(secret)*' : ''}`);
  }
  return lines.join('\n');
}

const opText = op => {
  const what = `${op.qty} ${op.item}`;
  if (op.type === 'gain') return `${where(op.to)} +${what}`;
  if (op.type === 'loss') return `${where(op.from)} −${what}${op.reason ? ` (${op.reason})` : ''}`;
  return `${what}: ${where(op.from)} → ${where(op.to)}`;
};

/** The line players see under the reply. */
export function formatLootLine({ applied, refused, invalid = [] }) {
  const lines = [];
  if (applied.length) lines.push(`🎒 **Loot:** ${applied.map(opText).join(' · ')}`);
  for (const { op, why } of refused) lines.push(`⚠️ Not recorded: ${op.text} (${why})`);
  for (const text of invalid) lines.push(`⚠️ Not recorded: ${text} (not understood)`);
  return lines.join('\n');
}

/** Short note stored with the DM reply, so saves and later turns see it. */
export function lootHistoryNote(applied) {
  return applied.length ? `(Loot recorded: ${applied.map(opText).join('; ')}.)` : '';
}
