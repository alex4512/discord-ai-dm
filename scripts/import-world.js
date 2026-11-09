// One-time world import into the active checkpoint, as a new version
// (see docs/DECISIONS.md, D-007 and D-009).
//
//   node scripts/import-world.js data/<file>.local.json
//
// Seed file: { "npcs": { "<name>": record }, "locations": { ... },
// "chronicle": [ { event, location, known_by } ] }. Every key is optional.
// A file that is just { "<npc name>": record } (old NPC seed format) is
// treated as { "npcs": ... }.
//
// Existing data is never overwritten: empty fields are filled, facts,
// author notes and events appended, and re-running is harmless.
//
// Seeds hold campaign canon and DM secrets. The repo is public, so keep
// them in data/*.local.json (gitignored).
import { readFile } from 'node:fs/promises';
import { config } from '../src/config.js';
import { pool } from '../src/db/pool.js';
import { importWorldSeed } from '../src/services/worldService.js';

const file = process.argv[2];

if (!file) {
  console.error('Usage: node scripts/import-world.js <seed.json>');
  process.exit(1);
}

const WORLD_KEYS = ['npcs', 'locations', 'chronicle'];

try {
  const raw = JSON.parse(await readFile(file, 'utf8'));
  const seed = Object.keys(raw).some(k => WORLD_KEYS.includes(k)) ? raw : { npcs: raw };
  const { version } = await importWorldSeed({
    guildId: config.discord.guildId,
    userId: 'import-script',
    seed
  });
  const summary = WORLD_KEYS
    .filter(k => seed[k])
    .map(k => `${Array.isArray(seed[k]) ? seed[k].length : Object.keys(seed[k]).length} ${k}`)
    .join(', ');
  console.log(`Imported ${summary} as checkpoint v${version}.`);
} catch (error) {
  console.error('Import failed:', error.message);
  process.exitCode = 1;
} finally {
  await pool.end();
}
