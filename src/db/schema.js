import { pool } from './pool.js';

const REQUIRED_TABLES = [
  'messages',
  'campaign_players',
  'campaign_npcs',
  'campaign_checkpoints',
  'campaign_state',
  'campaign_checkpoint_versions',
  'campaign_checkpoint_drafts'
];

const REQUIRED_COLUMNS = [
  ['messages', 'timeline_id'],
  ['campaign_state', 'timeline_id'],
  ['campaign_state', 'boundary_at'],
  ['campaign_checkpoint_versions', 'timeline_id'],
  ['campaign_checkpoint_versions', 'boundary_at'],
  ['campaign_checkpoint_versions', 'boundary_message_id'],
  ['campaign_checkpoint_drafts', 'timeline_id'],
  ['campaign_checkpoint_drafts', 'boundary_at'],
  ['campaign_checkpoint_drafts', 'boundary_message_id']
];

/**
 * Fails fast if the database is missing tables or columns the bot relies on.
 * This does not create anything; migrations are applied out of band.
 */
export async function verifySchema(db = pool) {
  for (const table of REQUIRED_TABLES) {
    const result = await db.query(
      'SELECT to_regclass($1) AS table_name',
      [`public.${table}`]
    );

    if (!result.rows[0].table_name) {
      throw new Error(`Missing database table: ${table}`);
    }
  }

  for (const [table, column] of REQUIRED_COLUMNS) {
    const result = await db.query(`
      SELECT 1
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = $1
        AND column_name = $2
    `, [table, column]);

    if (!result.rowCount) {
      throw new Error(`Missing column ${table}.${column}. Run migrations.`);
    }
  }
}
