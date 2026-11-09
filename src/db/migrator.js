import { readdir, readFile } from 'node:fs/promises';

const MIGRATIONS_DIR = new URL('../../migrations/', import.meta.url);
const MIGRATION_FILE = /^\d{4}_[\w-]+\.sql$/;
const LOCK_KEY = 'schema_migrations';

async function listMigrationFiles() {
  const files = await readdir(MIGRATIONS_DIR);
  return files.filter(name => MIGRATION_FILE.test(name)).sort();
}

async function getAppliedIds(db) {
  const exists = await db.query(
    "SELECT to_regclass('public.schema_migrations') AS t"
  );
  if (!exists.rows[0].t) return new Set();

  const result = await db.query('SELECT id FROM public.schema_migrations');
  return new Set(result.rows.map(row => row.id));
}

/** Migration file names that have not been applied yet, in order. */
export async function getPendingMigrations(db) {
  const [files, applied] = await Promise.all([
    listMigrationFiles(),
    getAppliedIds(db)
  ]);

  return files.filter(name => !applied.has(name));
}

/**
 * Applies pending migrations in order, each in its own transaction.
 * `db` must be a dedicated client (not a pool) so the transaction holds.
 * Returns the names of the migrations that were applied.
 */
export async function runMigrations(db, log = console.log) {
  await db.query(`
    CREATE TABLE IF NOT EXISTS public.schema_migrations (
      id         TEXT PRIMARY KEY,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  const applied = [];

  for (const name of await getPendingMigrations(db)) {
    const sql = await readFile(new URL(name, MIGRATIONS_DIR), 'utf8');

    try {
      await db.query('BEGIN');
      await db.query('SELECT pg_advisory_xact_lock(hashtext($1))', [LOCK_KEY]);

      // Another process may have applied it while we waited for the lock.
      const done = await db.query(
        'SELECT 1 FROM public.schema_migrations WHERE id = $1',
        [name]
      );

      if (!done.rowCount) {
        await db.query(sql);
        await db.query(
          'INSERT INTO public.schema_migrations (id) VALUES ($1)',
          [name]
        );
        applied.push(name);
        log(`Applied ${name}`);
      }

      await db.query('COMMIT');
    } catch (error) {
      await db.query('ROLLBACK').catch(() => {});
      throw new Error(`Migration ${name} failed: ${error.message}`, { cause: error });
    }
  }

  return applied;
}
