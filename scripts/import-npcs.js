// One-time NPC import into the active checkpoint, as a new version
// (see docs/DECISIONS.md, D-007).
//
//   node scripts/import-npcs.js data/npcs.local.json
//
// The seed file maps NPC name -> record (role, appearance, personality,
// status/location {value, known_by}, facts [{fact, known_by}],
// author_notes [string]). Existing NPC data is never overwritten: empty
// fields are filled, facts and author notes appended.
//
// Seed files hold campaign canon and DM secrets. The repo is public, so
// keep them in data/*.local.json (gitignored).
import { readFile } from 'node:fs/promises';
import { config } from '../src/config.js';
import { pool } from '../src/db/pool.js';
import { importNpcSeed } from '../src/services/npcService.js';

const file = process.argv[2];

if (!file) {
  console.error('Usage: node scripts/import-npcs.js <seed.json>');
  process.exit(1);
}

try {
  const seed = JSON.parse(await readFile(file, 'utf8'));
  const { version } = await importNpcSeed({
    guildId: config.discord.guildId,
    userId: 'import-script',
    seed
  });
  console.log(`Imported ${Object.keys(seed).length} NPC(s) as checkpoint v${version}.`);
} catch (error) {
  console.error('Import failed:', error.message);
  process.exitCode = 1;
} finally {
  await pool.end();
}
