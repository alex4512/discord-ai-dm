import { pool } from '../pool.js';

export async function getPlayer(guildId, discordUserId) {
  const result = await pool.query(`
    SELECT character_name, character_class, character_level
    FROM public.campaign_players
    WHERE guild_id = $1
      AND discord_user_id = $2
  `, [guildId, discordUserId]);

  return result.rows[0] || null;
}

export async function getPlayers(guildId) {
  const result = await pool.query(`
    SELECT character_name, character_class, character_level, discord_user_id
    FROM public.campaign_players
    WHERE guild_id = $1
    ORDER BY character_name
  `, [guildId]);

  return result.rows;
}
