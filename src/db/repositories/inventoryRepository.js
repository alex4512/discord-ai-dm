import { pool } from '../pool.js';

/**
 * Records inventory changes (D-022), in order; each gets the next shared seq.
 * `events`: [{ holder, item, itemKey, delta, secret, reason }].
 */
export async function insertEvents({
  guildId,
  timelineId,
  channelId,
  createdBy,
  events
}, db = pool) {
  for (const e of events) {
    await db.query(`
      INSERT INTO public.inventory_events (
        guild_id, timeline_id, holder, item, item_key, delta, secret,
        reason, channel_id, created_by
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
    `, [
      guildId, timelineId, e.holder, e.item, e.itemKey, e.delta,
      Boolean(e.secret), e.reason || '', channelId, createdBy
    ]);
  }
}

/**
 * Events on a timeline with `afterSeq < seq <= untilSeq` (untilSeq null =
 * no upper bound), oldest first.
 */
export async function listEvents({
  guildId,
  timelineId,
  afterSeq = null,
  untilSeq = null
}, db = pool) {
  const result = await db.query(`
    SELECT holder, item, item_key, delta, secret
    FROM public.inventory_events
    WHERE guild_id = $1
      AND timeline_id = $2
      AND seq > COALESCE($3::bigint, 0)
      AND ($4::bigint IS NULL OR seq <= $4::bigint)
    ORDER BY seq, id
  `, [guildId, timelineId, afterSeq, untilSeq]);

  return result.rows.map(r => ({
    holder: r.holder,
    item: r.item,
    itemKey: r.item_key,
    delta: r.delta,
    secret: r.secret
  }));
}
