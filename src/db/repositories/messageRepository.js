import { pool } from '../pool.js';
import { config } from '../../config.js';

/**
 * Returns the most recent messages of a channel on a timeline, oldest first,
 * capped at `maxChars` of total content. When `boundaryAt` is set, only
 * messages newer than the boundary are included.
 */
export async function getHistory({
  guildId,
  channelId,
  timelineId,
  boundaryAt = null,
  maxChars = config.history.maxChars,
  limit = config.history.fetchLimit
}) {
  const result = await pool.query(`
    SELECT role, content
    FROM public.messages
    WHERE guild_id = $1
      AND channel_id = $2
      AND timeline_id = $3
      AND ($4::timestamptz IS NULL OR created_at > $4::timestamptz)
    ORDER BY created_at DESC, id DESC
    LIMIT $5
  `, [guildId, channelId, timelineId, boundaryAt, limit]);

  // Rows are newest first: keep adding until the budget is exhausted.
  const history = [];
  let total = 0;

  for (const { role, content } of result.rows) {
    if (total + content.length > maxChars) break;
    history.push({ role, content });
    total += content.length;
  }

  return history.reverse();
}

export async function storeMessage({
  id,
  guildId,
  channelId,
  authorId,
  role,
  content,
  timelineId
}) {
  await pool.query(`
    INSERT INTO public.messages (
      id, guild_id, channel_id, author_id, role, content, timeline_id
    )
    VALUES ($1, $2, $3, $4, $5, $6, $7)
    ON CONFLICT (id) DO NOTHING
  `, [id, guildId, channelId, authorId, role, content, timelineId]);
}

export async function getLatestMessageId({
  guildId,
  channelId,
  timelineId
}, db = pool) {
  const result = await db.query(`
    SELECT id
    FROM public.messages
    WHERE guild_id = $1
      AND channel_id = $2
      AND timeline_id = $3
    ORDER BY created_at DESC, id DESC
    LIMIT 1
  `, [guildId, channelId, timelineId]);

  return result.rows[0]?.id || null;
}

/** True if any message in `channelIds` was stored after `since`. */
export async function hasMessagesSince({
  guildId,
  timelineId,
  channelIds,
  since
}, db = pool) {
  const result = await db.query(`
    SELECT EXISTS (
      SELECT 1
      FROM public.messages
      WHERE guild_id = $1
        AND timeline_id = $2
        AND channel_id = ANY($3::text[])
        AND created_at > $4::timestamptz
    ) AS changed
  `, [guildId, timelineId, channelIds, since]);

  return result.rows[0].changed;
}
