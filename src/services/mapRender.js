import { Resvg } from '@resvg/resvg-js';
import { FEATURE_KINDS, TOKEN_SIDES } from '../ai/mapSchema.js';

/**
 * Draws a scene sketch (D-018) from map data: a monospace text grid for
 * Discord, or a PNG battle-map. Pure apart from rasterizing.
 */

const MIN_SIZE = 4;
const MAX_SIZE = 24;
const clamp = (n, lo, hi) => Math.min(Math.max(Math.round(Number(n) || 0), lo), hi);

/** Clamps sizes, drops out-of-range items, makes token ids unique. */
export function normalizeMap(raw) {
  const width = clamp(raw?.width, MIN_SIZE, MAX_SIZE);
  const height = clamp(raw?.height, MIN_SIZE, MAX_SIZE);
  const inside = (x, y) => x >= 1 && x <= width && y >= 1 && y <= height;

  const features = (raw?.features || [])
    .filter(f => FEATURE_KINDS.includes(f?.kind))
    .map(f => {
      const x = clamp(f.x, 1, width);
      const y = clamp(f.y, 1, height);
      return {
        kind: f.kind,
        x,
        y,
        w: clamp(f.w, 1, width - x + 1),
        h: clamp(f.h, 1, height - y + 1),
        label: String(f.label || '').trim()
      };
    });

  const used = new Set();
  const occupied = new Set();
  const tokens = [];
  for (const t of raw?.tokens || []) {
    const x = Math.round(Number(t?.x));
    const y = Math.round(Number(t?.y));
    if (!inside(x, y) || occupied.has(`${x},${y}`)) continue;

    let id = String(t.id || t.name || '?').replace(/[^A-Za-z0-9]/g, '').slice(0, 2).toUpperCase() || '?';
    for (let n = 2; used.has(id); n++) id = `${id[0]}${n}`.slice(0, 2);
    used.add(id);
    occupied.add(`${x},${y}`);
    tokens.push({
      id,
      name: String(t.name || id).trim(),
      side: TOKEN_SIDES.includes(t.side) ? t.side : 'neutral',
      x,
      y
    });
  }

  return {
    title: String(raw?.title || 'Scene').trim(),
    width,
    height,
    features,
    tokens,
    notes: String(raw?.notes || '').trim()
  };
}

const TEXT_SYMBOL = {
  wall: '#', door: '+', water: '~', difficult: '^', cover: 'o',
  tree: 'T', fire: '*', pit: 'O', stairs: '=', other: '?'
};
const FEATURE_NAME = {
  wall: 'wall', door: 'door', water: 'water', difficult: 'difficult terrain',
  cover: 'cover', tree: 'tree', fire: 'fire', pit: 'pit', stairs: 'stairs', other: 'other'
};
const column = i => String.fromCharCode(65 + i); // A..X

function grid(map) {
  const cells = Array.from({ length: map.height }, () => Array(map.width).fill(null));
  for (const f of map.features) {
    for (let y = f.y; y < f.y + f.h; y++) {
      for (let x = f.x; x < f.x + f.w; x++) cells[y - 1][x - 1] = { feature: f.kind };
    }
  }
  for (const t of map.tokens) cells[t.y - 1][t.x - 1] = { token: t };
  return cells;
}

/** Legend lines shared by both renderings. */
export function mapLegend(map) {
  const tokens = map.tokens.map(t => `${t.id} = ${t.name}${t.side === 'enemy' ? ' (enemy)' : ''}`);
  const kinds = [...new Set(map.features.map(f => f.kind))];
  return { tokens, kinds };
}

/** "cover (broken cart, barrels)": the kind with its labels, walls bare. */
function kindWithLabels(map, kind) {
  const labels = kind === 'wall'
    ? []
    : [...new Set(map.features.filter(f => f.kind === kind && f.label).map(f => f.label))];
  return labels.length ? `${FEATURE_NAME[kind]} (${labels.join(', ')})` : FEATURE_NAME[kind];
}

/** A monospace grid for a Discord code block. */
export function renderTextMap(map) {
  const cells = grid(map);
  const header = '   ' + Array.from({ length: map.width }, (_, i) => column(i).padEnd(2)).join('');
  const rows = cells.map((row, y) =>
    String(y + 1).padStart(2) + ' ' +
    row.map(c => (c?.token ? c.token.id.padEnd(2) : c?.feature ? `${TEXT_SYMBOL[c.feature]} ` : '. ')).join('')
  );
  const { tokens, kinds } = mapLegend(map);
  const legend = [
    tokens.join('  '),
    kinds.map(k => `${TEXT_SYMBOL[k]}=${kindWithLabels(map, k)}`).join('  ')
  ].filter(Boolean);

  return [
    `**${map.title}** (1 square = 5 ft)`,
    '```',
    header.trimEnd(),
    ...rows.map(r => r.trimEnd()),
    '```',
    ...legend,
    ...(map.notes ? [`*${map.notes}*`] : [])
  ].join('\n');
}

const CELL = 44;
const MARGIN = 26;
const TITLE = 34;
const FEATURE_FILL = {
  wall: '#4a4a4a', door: '#8b5a2b', water: '#7fb3d5', difficult: '#cdb88a',
  cover: '#9e9e9e', tree: '#4f7942', fire: '#e8743b', pit: '#2b2b2b',
  stairs: '#b8a888', other: '#c8c8c8'
};
const SIDE_FILL = { party: '#2e7d32', ally: '#1565c0', enemy: '#c62828', neutral: '#6d6d6d' };
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

/** SVG battle-map. */
export function renderSvg(map) {
  const w = MARGIN + map.width * CELL + 8;
  const h = TITLE + MARGIN + map.height * CELL + 8;
  const ox = MARGIN;
  const oy = TITLE + MARGIN;
  const parts = [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" font-family="Arial, Helvetica, sans-serif">`,
    `<rect width="${w}" height="${h}" fill="#efe6d2"/>`,
    `<text x="${w / 2}" y="23" font-size="18" font-weight="bold" text-anchor="middle" fill="#3b2f20">${esc(map.title)} · 1 square = 5 ft</text>`
  ];

  for (const f of map.features) {
    const x = ox + (f.x - 1) * CELL;
    const y = oy + (f.y - 1) * CELL;
    const fw = f.w * CELL;
    const fh = f.h * CELL;
    if (f.kind === 'tree') {
      for (let i = 0; i < f.w; i++) {
        for (let j = 0; j < f.h; j++) {
          parts.push(`<circle cx="${x + i * CELL + CELL / 2}" cy="${y + j * CELL + CELL / 2}" r="${CELL * 0.42}" fill="${FEATURE_FILL.tree}"/>`);
        }
      }
    } else {
      parts.push(`<rect x="${x}" y="${y}" width="${fw}" height="${fh}" fill="${FEATURE_FILL[f.kind]}"${f.kind === 'difficult' ? ' fill-opacity="0.75"' : ''}/>`);
    }
  }

  for (let i = 0; i <= map.width; i++) {
    parts.push(`<line x1="${ox + i * CELL}" y1="${oy}" x2="${ox + i * CELL}" y2="${oy + map.height * CELL}" stroke="#8a7a60" stroke-opacity="0.45"/>`);
  }
  for (let j = 0; j <= map.height; j++) {
    parts.push(`<line x1="${ox}" y1="${oy + j * CELL}" x2="${ox + map.width * CELL}" y2="${oy + j * CELL}" stroke="#8a7a60" stroke-opacity="0.45"/>`);
  }
  for (let i = 0; i < map.width; i++) {
    parts.push(`<text x="${ox + i * CELL + CELL / 2}" y="${oy - 8}" font-size="12" text-anchor="middle" fill="#5a4a35">${column(i)}</text>`);
  }
  for (let j = 0; j < map.height; j++) {
    parts.push(`<text x="${ox - 6}" y="${oy + j * CELL + CELL / 2 + 4}" font-size="12" text-anchor="end" fill="#5a4a35">${j + 1}</text>`);
  }

  for (const t of map.tokens) {
    const cx = ox + (t.x - 1) * CELL + CELL / 2;
    const cy = oy + (t.y - 1) * CELL + CELL / 2;
    parts.push(`<circle cx="${cx}" cy="${cy}" r="${CELL * 0.38}" fill="${SIDE_FILL[t.side]}" stroke="#ffffff" stroke-width="2"/>`);
    parts.push(`<text x="${cx}" y="${cy + 5}" font-size="14" font-weight="bold" text-anchor="middle" fill="#ffffff">${esc(t.id)}</text>`);
  }

  // Feature labels last, as small tags in the feature's top-left corner,
  // truncated to its width. Walls are self-evident and get none.
  for (const f of map.features) {
    if (!f.label || f.kind === 'wall') continue;
    const maxChars = Math.max(3, Math.floor((f.w * CELL - 6) / 6));
    const label = f.label.length > maxChars ? `${f.label.slice(0, maxChars - 1)}…` : f.label;
    const x = ox + (f.x - 1) * CELL + 2;
    const y = oy + (f.y - 1) * CELL + 2;
    parts.push(`<rect x="${x}" y="${y}" width="${label.length * 6 + 6}" height="14" rx="3" fill="#fffaf0" fill-opacity="0.85"/>`);
    parts.push(`<text x="${x + 3}" y="${y + 11}" font-size="10" fill="#2b2b2b">${esc(label)}</text>`);
  }

  parts.push('</svg>');
  return parts.join('');
}

/** PNG buffer of the battle-map. */
export function renderPng(map) {
  return Buffer.from(new Resvg(renderSvg(map), { background: '#efe6d2' }).render().asPng());
}

export const MAP_NOTE_PREFIX = '(Scene map:';

const square = (x, y) => `${column(x - 1)}${y}`;

/**
 * Compact note stored in the channel's history (D-019), so later replies
 * and the next /map know the sketched positions, e.g.
 * "(Scene map: Yard, 12×8, 1 square = 5 ft. Tokens: K C6 Kraavok, G1 F2
 *  Goblin (enemy). Terrain: door B4 (rear exit), difficult C5–G7 (mud).)"
 */
export function compactMapNote(map) {
  const tokens = map.tokens
    .map(t => `${t.id} ${square(t.x, t.y)} ${t.name}${t.side === 'enemy' ? ' (enemy)' : t.side === 'neutral' ? ' (neutral)' : ''}`)
    .join(', ');
  const terrain = map.features
    .map(f => {
      const area = f.w === 1 && f.h === 1
        ? square(f.x, f.y)
        : `${square(f.x, f.y)}–${square(f.x + f.w - 1, f.y + f.h - 1)}`;
      return `${FEATURE_NAME[f.kind]} ${area}${f.label ? ` (${f.label})` : ''}`;
    })
    .join(', ');
  return (
    `${MAP_NOTE_PREFIX} ${map.title}, ${map.width}×${map.height}, 1 square = 5 ft, ` +
    `columns A–${column(map.width - 1)}, rows 1–${map.height}. ` +
    `Tokens: ${tokens || 'none'}. Terrain: ${terrain || 'open ground'}.)`
  );
}

/** Text legend posted with the PNG. */
export function renderLegendText(map) {
  const { tokens, kinds } = mapLegend(map);
  return [
    tokens.join(' · '),
    kinds.length ? `Terrain: ${kinds.map(k => kindWithLabels(map, k)).join(', ')}` : '',
    map.notes ? `*${map.notes}*` : ''
  ].filter(Boolean).join('\n');
}
