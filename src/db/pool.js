import pg from 'pg';
import { config } from '../config.js';

export const pool = new pg.Pool(config.postgres);

/**
 * Runs `fn(db)` inside a transaction that holds a per-guild advisory lock,
 * so checkpoint mutations for the same guild are serialized.
 * Any thrown error rolls the transaction back.
 */
export async function withGuildTransaction(guildId, fn) {
  const db = await pool.connect();

  try {
    await db.query('BEGIN');
    await db.query('SELECT pg_advisory_xact_lock(hashtext($1))', [guildId]);

    const result = await fn(db);

    await db.query('COMMIT');
    return result;
  } catch (error) {
    await db.query('ROLLBACK').catch(rollbackError => {
      console.error('Rollback failed:', rollbackError);
    });
    throw error;
  } finally {
    db.release();
  }
}

/** Current database time (wall clock, not transaction start). */
export async function getDatabaseTime(db = pool) {
  const result = await db.query('SELECT clock_timestamp() AS now');
  return result.rows[0].now;
}
