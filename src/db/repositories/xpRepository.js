import { pool } from '../pool.js';

/** Records one award per character (D-014). Returns the inserted rows. */
export async function insertAwards({
  guildId,
  timelineId,
  channelId,
  createdBy,
  entries
}, db = pool) {
  const rows = [];
  for (const { characterName, amount, reason } of entries) {
    const result = await db.query(`
      INSERT INTO public.xp_awards (
        guild_id, timeline_id, character_name, amount, reason, channel_id, created_by
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7)
      RETURNING seq, character_name, amount
    `, [guildId, timelineId, characterName, amount, reason, channelId, createdBy]);
    rows.push(result.rows[0]);
  }
  return rows;
}

/**
 * Sum of awards per character on a timeline with
 * `afterSeq < seq <= untilSeq` (untilSeq null = no upper bound).
 */
export async function sumAwards({
  guildId,
  timelineId,
  afterSeq = null,
  untilSeq = null
}, db = pool) {
  const result = await db.query(`
    SELECT character_name, SUM(amount)::int AS total
    FROM public.xp_awards
    WHERE guild_id = $1
      AND timeline_id = $2
      AND seq > COALESCE($3::bigint, 0)
      AND ($4::bigint IS NULL OR seq <= $4::bigint)
    GROUP BY character_name
  `, [guildId, timelineId, afterSeq, untilSeq]);

  return Object.fromEntries(result.rows.map(r => [r.character_name, r.total]));
}
