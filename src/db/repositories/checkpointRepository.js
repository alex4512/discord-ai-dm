import { pool } from '../pool.js';

// A "snapshot" is the audience partitions saved together:
//   { checkpoint, character_knowledge, dm_notes, npcs }

// ---------- Legacy (pre-versioning) checkpoint ----------

export async function getLegacyCheckpoint({ guildId, characterName, ownerId }) {
  const result = await pool.query(`
    SELECT checkpoint
    FROM public.campaign_checkpoints
    WHERE guild_id = $1
      AND character_name = $2
      AND owner_discord_id = $3
    LIMIT 1
  `, [guildId, characterName, ownerId]);

  return result.rows[0]?.checkpoint || null;
}

// ---------- Drafts (one per guild) ----------

const DRAFT_COLUMNS = `
  checkpoint, character_knowledge, dm_notes, npcs, based_on_version, created_by,
  timeline_id, boundary_message_id, boundary_at, boundary_seq, created_at
`;

export async function upsertDraft({
  guildId,
  snapshot,
  basedOnVersion,
  createdBy,
  timelineId,
  boundaryMessageId,
  boundaryAt,
  boundarySeq
}, db = pool) {
  await db.query(`
    INSERT INTO public.campaign_checkpoint_drafts (
      guild_id, checkpoint, character_knowledge, dm_notes, npcs,
      based_on_version, created_by, timeline_id,
      boundary_message_id, boundary_at, boundary_seq, created_at
    )
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, NOW())
    ON CONFLICT (guild_id) DO UPDATE SET
      checkpoint = EXCLUDED.checkpoint,
      character_knowledge = EXCLUDED.character_knowledge,
      dm_notes = EXCLUDED.dm_notes,
      npcs = EXCLUDED.npcs,
      based_on_version = EXCLUDED.based_on_version,
      created_by = EXCLUDED.created_by,
      timeline_id = EXCLUDED.timeline_id,
      boundary_message_id = EXCLUDED.boundary_message_id,
      boundary_at = EXCLUDED.boundary_at,
      boundary_seq = EXCLUDED.boundary_seq,
      created_at = NOW()
  `, [
    guildId,
    snapshot.checkpoint,
    snapshot.character_knowledge,
    snapshot.dm_notes,
    snapshot.npcs,
    basedOnVersion,
    createdBy,
    timelineId,
    boundaryMessageId,
    boundaryAt,
    boundarySeq
  ]);
}

export async function getDraft(guildId, db = pool) {
  const result = await db.query(`
    SELECT ${DRAFT_COLUMNS}
    FROM public.campaign_checkpoint_drafts
    WHERE guild_id = $1
  `, [guildId]);

  return result.rows[0] || null;
}

export async function getDraftForUpdate(db, guildId) {
  const result = await db.query(`
    SELECT ${DRAFT_COLUMNS}
    FROM public.campaign_checkpoint_drafts
    WHERE guild_id = $1
    FOR UPDATE
  `, [guildId]);

  return result.rows[0] || null;
}

export async function deleteDraft(guildId, db = pool) {
  await db.query(`
    DELETE FROM public.campaign_checkpoint_drafts
    WHERE guild_id = $1
  `, [guildId]);
}

/** Deletes the draft only if `userId` created it. Returns true if deleted. */
export async function deleteDraftOwnedBy(guildId, userId, db = pool) {
  const result = await db.query(`
    DELETE FROM public.campaign_checkpoint_drafts
    WHERE guild_id = $1
      AND created_by = $2
  `, [guildId, userId]);

  return result.rowCount > 0;
}

// ---------- Version history (immutable) ----------

export async function insertVersion(db, {
  guildId,
  version,
  snapshot,
  createdBy,
  reason,
  timelineId,
  boundaryMessageId = null,
  boundaryAt = null,
  boundarySeq = null
}) {
  await db.query(`
    INSERT INTO public.campaign_checkpoint_versions (
      guild_id, version, checkpoint, character_knowledge, dm_notes, npcs,
      created_by, reason, timeline_id,
      boundary_message_id, boundary_at, boundary_seq
    )
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
  `, [
    guildId,
    version,
    snapshot.checkpoint,
    snapshot.character_knowledge,
    snapshot.dm_notes,
    snapshot.npcs,
    createdBy,
    reason,
    timelineId,
    boundaryMessageId,
    boundaryAt,
    boundarySeq
  ]);
}

export async function getVersion(guildId, version, db = pool) {
  const result = await db.query(`
    SELECT checkpoint, character_knowledge, dm_notes, npcs
    FROM public.campaign_checkpoint_versions
    WHERE guild_id = $1
      AND version = $2
  `, [guildId, version]);

  return result.rows[0] || null;
}

export async function listVersions(guildId, limit, db = pool) {
  const result = await db.query(`
    SELECT version, reason, created_at
    FROM public.campaign_checkpoint_versions
    WHERE guild_id = $1
    ORDER BY version DESC
    LIMIT $2
  `, [guildId, limit]);

  return result.rows;
}
