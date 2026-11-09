import { pool } from '../pool.js';

export async function getState(guildId, db = pool) {
  const result = await db.query(`
    SELECT checkpoint, version, timeline_id, boundary_at, boundary_seq
    FROM public.campaign_state
    WHERE guild_id = $1
  `, [guildId]);

  return result.rows[0] || null;
}

export async function getStateForUpdate(db, guildId) {
  const result = await db.query(`
    SELECT version, timeline_id
    FROM public.campaign_state
    WHERE guild_id = $1
    FOR UPDATE
  `, [guildId]);

  return result.rows[0] || null;
}

/**
 * Creates the guild's state row if missing and backfills a timeline id
 * for rows created before timelines existed.
 */
export async function ensureState(guildId, newTimelineId, db = pool) {
  await db.query(`
    INSERT INTO public.campaign_state (
      guild_id, checkpoint, version, timeline_id, boundary_at
    )
    VALUES ($1, '{}'::jsonb, 0, $2, NULL)
    ON CONFLICT (guild_id) DO NOTHING
  `, [guildId, newTimelineId]);

  await db.query(`
    UPDATE public.campaign_state
    SET timeline_id = $2
    WHERE guild_id = $1
      AND timeline_id IS NULL
  `, [guildId, newTimelineId]);
}

/** Advances the checkpoint on the current timeline (after a save). */
export async function advanceCheckpoint(db, {
  guildId,
  checkpoint,
  version,
  boundaryAt,
  boundarySeq
}) {
  await db.query(`
    UPDATE public.campaign_state
    SET checkpoint = $2,
        version = $3,
        boundary_at = $4,
        boundary_seq = $5,
        updated_at = NOW()
    WHERE guild_id = $1
  `, [guildId, checkpoint, version, boundaryAt, boundarySeq]);
}

/** Restores a checkpoint onto a brand-new timeline (after a rollback). */
export async function resetToTimeline(db, {
  guildId,
  checkpoint,
  version,
  timelineId
}) {
  await db.query(`
    UPDATE public.campaign_state
    SET checkpoint = $2,
        version = $3,
        timeline_id = $4,
        boundary_at = NULL,
        boundary_seq = NULL,
        updated_at = NOW()
    WHERE guild_id = $1
  `, [guildId, checkpoint, version, timelineId]);
}
