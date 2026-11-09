import { pool } from '../pool.js';
import {
  PARTITIONS,
  PARTITION_COLUMNS,
  partitionPlaceholders,
  partitionValues
} from '../partitions.js';

// A "snapshot" is the partitions saved together (see db/partitions.js).
const N = PARTITIONS.length;

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

const DRAFT_META = [
  'based_on_version',
  'created_by',
  'timeline_id',
  'boundary_message_id',
  'boundary_at',
  'boundary_seq'
];

const DRAFT_COLUMNS = `${PARTITION_COLUMNS}, ${DRAFT_META.join(', ')}, created_at`;

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
  const columns = [...PARTITIONS, ...DRAFT_META];
  const placeholders = columns.map((_, i) => `$${i + 2}`).join(', ');
  const updates = columns.map(c => `${c} = EXCLUDED.${c}`).join(',\n      ');

  await db.query(`
    INSERT INTO public.campaign_checkpoint_drafts (
      guild_id, ${columns.join(', ')}, created_at
    )
    VALUES ($1, ${placeholders}, NOW())
    ON CONFLICT (guild_id) DO UPDATE SET
      ${updates},
      created_at = NOW()
  `, [
    guildId,
    ...partitionValues(snapshot),
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
      guild_id, version, ${PARTITION_COLUMNS},
      created_by, reason, timeline_id,
      boundary_message_id, boundary_at, boundary_seq
    )
    VALUES (
      $1, $2, ${partitionPlaceholders(3)},
      $${N + 3}, $${N + 4}, $${N + 5}, $${N + 6}, $${N + 7}, $${N + 8}
    )
  `, [
    guildId,
    version,
    ...partitionValues(snapshot),
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
    SELECT ${PARTITION_COLUMNS}
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
