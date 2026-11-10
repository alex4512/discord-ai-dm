import { pool } from '../pool.js';
import { config } from '../../config.js';

/**
 * Returns the most recent messages of a channel on a timeline, oldest first,
 * capped at `maxChars` of total content.
 *
 * - `afterSeq`: only messages after this checkpoint boundary (null = all).
 * - `untilSeq`: only messages up to this high-water mark (null = no cap).
 */
export async function getHistory({
  guildId,
  channelId,
  timelineId,
  afterSeq = null,
  untilSeq = null,
  maxChars = config.history.maxChars,
  limit = config.history.fetchLimit
}) {
  const result = await pool.query(`
    SELECT role, content
    FROM public.messages
    WHERE guild_id = $1
      AND timeline_id = $2
      AND channel_id = $3
      AND seq > COALESCE($4::bigint, 0)
      AND ($5::bigint IS NULL OR seq <= $5::bigint)
    ORDER BY seq DESC
    LIMIT $6
  `, [guildId, timelineId, channelId, afterSeq, untilSeq, limit]);

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

/** Inserts a message and returns its seq (null if the id already existed). */
export async function storeMessage({
  id,
  guildId,
  channelId,
  authorId,
  role,
  content,
  timelineId
}) {
  const result = await pool.query(`
    INSERT INTO public.messages (
      id, guild_id, channel_id, author_id, role, content, timeline_id
    )
    VALUES ($1, $2, $3, $4, $5, $6, $7)
    ON CONFLICT (id) DO NOTHING
    RETURNING seq
  `, [id, guildId, channelId, authorId, role, content, timelineId]);

  return result.rows[0]?.seq ?? null;
}

export async function deleteMessage(id) {
  await pool.query('DELETE FROM public.messages WHERE id = $1', [id]);
}

/**
 * Highest seq stored for the guild (0 if none): a high-water mark. XP awards
 * share the messages sequence (D-014), so the mark covers both.
 */
export async function getHighWaterSeq(guildId, db = pool) {
  const result = await db.query(`
    SELECT GREATEST(
      (SELECT COALESCE(MAX(seq), 0) FROM public.messages WHERE guild_id = $1),
      (SELECT COALESCE(MAX(seq), 0) FROM public.xp_awards WHERE guild_id = $1),
      (SELECT COALESCE(MAX(seq), 0) FROM public.inventory_events WHERE guild_id = $1)
    ) AS seq
  `, [guildId]);

  return result.rows[0].seq;
}

/** Id of the newest message in a channel up to `untilSeq`. */
export async function getLatestMessageId({
  guildId,
  channelId,
  timelineId,
  untilSeq = null
}, db = pool) {
  const result = await db.query(`
    SELECT id
    FROM public.messages
    WHERE guild_id = $1
      AND timeline_id = $2
      AND channel_id = $3
      AND ($4::bigint IS NULL OR seq <= $4::bigint)
    ORDER BY seq DESC
    LIMIT 1
  `, [guildId, timelineId, channelId, untilSeq]);

  return result.rows[0]?.id || null;
}

/** True if any message in `channelIds` was stored after `sinceSeq`. */
export async function hasMessagesAfter({
  guildId,
  timelineId,
  channelIds,
  sinceSeq
}, db = pool) {
  const result = await db.query(`
    SELECT EXISTS (
      SELECT 1
      FROM public.messages
      WHERE guild_id = $1
        AND timeline_id = $2
        AND channel_id = ANY($3::text[])
        AND seq > COALESCE($4::bigint, 0)
    ) AS changed
  `, [guildId, timelineId, channelIds, sinceSeq]);

  return result.rows[0].changed;
}
