import { pool } from '../pool.js';

export async function getState(guildId, db = pool) {
  const result = await db.query(`
    SELECT checkpoint, character_knowledge, dm_notes, npcs,
           version, timeline_id, boundary_at, boundary_seq
    FROM public.campaign_state
    WHERE guild_id = $1
  `, [guildId]);

  return result.rows[0] || null;
}

export async function getStateForUpdate(db, guildId) {
  const result = await db.query(`
    SELECT checkpoint, character_knowledge, dm_notes, npcs,
           version, timeline_id, boundary_at, boundary_seq
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

/** Advances the snapshot on the current timeline (after a save). */
export async function advanceCheckpoint(db, {
  guildId,
  snapshot,
  version,
  boundaryAt,
  boundarySeq
}) {
  await db.query(`
    UPDATE public.campaign_state
    SET checkpoint = $2,
        character_knowledge = $3,
        dm_notes = $4,
        npcs = $5,
        version = $6,
        boundary_at = $7,
        boundary_seq = $8,
        updated_at = NOW()
    WHERE guild_id = $1
  `, [
    guildId,
    snapshot.checkpoint,
    snapshot.character_knowledge,
    snapshot.dm_notes,
    snapshot.npcs,
    version,
    boundaryAt,
    boundarySeq
  ]);
}

/** Restores a snapshot onto a brand-new timeline (after a rollback). */
export async function resetToTimeline(db, {
  guildId,
  snapshot,
  version,
  timelineId
}) {
  await db.query(`
    UPDATE public.campaign_state
    SET checkpoint = $2,
        character_knowledge = $3,
        dm_notes = $4,
        npcs = $5,
        version = $6,
        timeline_id = $7,
        boundary_at = NULL,
        boundary_seq = NULL,
        updated_at = NOW()
    WHERE guild_id = $1
  `, [
    guildId,
    snapshot.checkpoint,
    snapshot.character_knowledge,
    snapshot.dm_notes,
    snapshot.npcs,
    version,
    timelineId
  ]);
}

/**
 * Replaces the snapshot and bumps the version on the current timeline,
 * keeping the history boundary (e.g. a DM-authored NPC note).
 */
export async function replaceSnapshot(db, { guildId, snapshot, version }) {
  await db.query(`
    UPDATE public.campaign_state
    SET checkpoint = $2,
        character_knowledge = $3,
        dm_notes = $4,
        npcs = $5,
        version = $6,
        updated_at = NOW()
    WHERE guild_id = $1
  `, [
    guildId,
    snapshot.checkpoint,
    snapshot.character_knowledge,
    snapshot.dm_notes,
    snapshot.npcs,
    version
  ]);
}
