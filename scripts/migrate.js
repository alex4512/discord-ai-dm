// Usage:
//   npm run migrate            apply pending migrations
//   npm run migrate -- status  list pending migrations without applying
//
// Only needs the PG* variables from .env (pg reads them natively).
import 'dotenv/config';
import pg from 'pg';
import { getPendingMigrations, runMigrations } from '../src/db/migrator.js';

const client = new pg.Client();

try {
  await client.connect();

  if (process.argv[2] === 'status') {
    const pending = await getPendingMigrations(client);
    console.log(
      pending.length
        ? `Pending:\n  ${pending.join('\n  ')}`
        : 'Database is up to date.'
    );
  } else {
    const applied = await runMigrations(client);
    console.log(
      applied.length
        ? `Done: ${applied.length} migration(s) applied.`
        : 'Database is up to date.'
    );
  }
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
} finally {
  await client.end();
}
