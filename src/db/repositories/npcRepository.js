import { pool } from '../pool.js';

/** Full NPC rows, including DM-only `secrets`. */
export async function getNpcs(guildId) {
  const result = await pool.query(`
    SELECT name, location, status, description, personality, knowledge, secrets
    FROM public.campaign_npcs
    WHERE guild_id = $1
    ORDER BY name
  `, [guildId]);

  return result.rows;
}

/** Strips DM-only fields so the NPC can be shared with players. */
export function toPublicNpc({ secrets, ...publicFields }) {
  return publicFields;
}
