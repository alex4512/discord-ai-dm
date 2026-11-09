import { pool } from '../pool.js';

/** Images generated for the guild in the last 24 hours (D-008 cap). */
export async function countRecentImages(guildId) {
  const result = await pool.query(`
    SELECT COUNT(*)::int AS n
    FROM public.image_generations
    WHERE guild_id = $1
      AND created_at > NOW() - INTERVAL '24 hours'
  `, [guildId]);

  return result.rows[0].n;
}

export async function logImageGeneration({
  guildId, channelId, userId, trigger, model, size, quality, prompt
}) {
  await pool.query(`
    INSERT INTO public.image_generations (
      guild_id, channel_id, user_id, trigger, model, size, quality, prompt
    )
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
  `, [guildId, channelId, userId, trigger, model, size, quality, prompt]);
}

/**
 * Records a first arrival. Returns false if this audience already arrived
 * at this place on this timeline (so no image is posted twice).
 */
export async function recordArrival({ guildId, timelineId, audienceKey, locationKey }) {
  const result = await pool.query(`
    INSERT INTO public.scene_arrivals (guild_id, timeline_id, audience_key, location_key)
    VALUES ($1, $2, $3, $4)
    ON CONFLICT DO NOTHING
  `, [guildId, timelineId, audienceKey, locationKey]);

  return result.rowCount > 0;
}

export async function getSceneImage({ guildId, audienceKey, locationKey }) {
  const result = await pool.query(`
    SELECT image, prompt
    FROM public.scene_images
    WHERE guild_id = $1 AND audience_key = $2 AND location_key = $3
  `, [guildId, audienceKey, locationKey]);

  return result.rows[0] || null;
}

export async function saveSceneImage({ guildId, audienceKey, locationKey, prompt, image }) {
  await pool.query(`
    INSERT INTO public.scene_images (guild_id, audience_key, location_key, prompt, image)
    VALUES ($1, $2, $3, $4, $5)
    ON CONFLICT (guild_id, audience_key, location_key) DO NOTHING
  `, [guildId, audienceKey, locationKey, prompt, image]);
}
