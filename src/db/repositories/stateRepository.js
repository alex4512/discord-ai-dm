import { pool } from '../pool.js';
import {
  PARTITIONS,
  PARTITION_COLUMNS,
  partitionAssignments,
  partitionValues
} from '../partitions.js';

const STATE_COLUMNS = `${PARTITION_COLUMNS}, version, timeline_id, boundary_at, boundary_seq`;
const N = PARTITIONS.length;

export async function getState(guildId, db = pool) {
  const result = await db.query(`
    SELECT ${STATE_COLUMNS}
    FROM public.campaign_state
    WHERE guild_id = $1
  `, [guildId]);

  return result.rows[0] || null;
}

export async function getStateForUpdate(db, guildId) {
  const result = await db.query(`
    SELECT ${STATE_COLUMNS}
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
    SET ${partitionAssignments(2)},
        version = $${N + 2},
        boundary_at = $${N + 3},
        boundary_seq = $${N + 4},
        updated_at = NOW()
    WHERE guild_id = $1
  `, [guildId, ...partitionValues(snapshot), version, boundaryAt, boundarySeq]);
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
    SET ${partitionAssignments(2)},
        version = $${N + 2},
        timeline_id = $${N + 3},
        boundary_at = NULL,
        boundary_seq = NULL,
        updated_at = NOW()
    WHERE guild_id = $1
  `, [guildId, ...partitionValues(snapshot), version, timelineId]);
}

/**
 * Replaces the snapshot and bumps the version on the current timeline,
 * keeping the history boundary (e.g. a DM-authored NPC note).
 */
export async function replaceSnapshot(db, { guildId, snapshot, version }) {
  await db.query(`
    UPDATE public.campaign_state
    SET ${partitionAssignments(2)},
        version = $${N + 2},
        updated_at = NOW()
    WHERE guild_id = $1
  `, [guildId, ...partitionValues(snapshot), version]);
}
