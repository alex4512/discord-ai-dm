import { pool } from './pool.js';
import { getPendingMigrations } from './migrator.js';

/**
 * Refuses to start the bot against a database that is missing migrations.
 * Migrations are applied explicitly with `npm run migrate`.
 */
export async function verifySchema(db = pool) {
  const pending = await getPendingMigrations(db);

  if (pending.length) {
    throw new Error(
      `Database has pending migrations: ${pending.join(', ')}. ` +
      'Run `npm run migrate`.'
    );
  }
}
