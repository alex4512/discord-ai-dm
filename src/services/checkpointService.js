import { randomUUID } from 'node:crypto';
import { config } from '../config.js';
import { CHECKPOINT_VERSIONS_LIST_LIMIT } from '../constants.js';
import { UserFacingError } from '../errors/UserFacingError.js';
import { getDatabaseTime, withGuildTransaction } from '../db/pool.js';
import * as stateRepo from '../db/repositories/stateRepository.js';
import * as checkpointRepo from '../db/repositories/checkpointRepository.js';
import {
  getHighWaterSeq,
  getHistory,
  getLatestMessageId,
  hasMessagesAfter
} from '../db/repositories/messageRepository.js';
import { getPlayers } from '../db/repositories/playerRepository.js';
import { getNpcs, toPublicNpc } from '../db/repositories/npcRepository.js';
import { generateCheckpoint } from '../ai/dungeonMaster.js';
import { toCharacterSummary } from '../ai/prompts.js';
import { getCampaignLegacyCheckpoint } from './campaignService.js';

function campaignChangedAfter(guildId, timelineId, sinceSeq, db) {
  return hasMessagesAfter({
    guildId,
    timelineId,
    channelIds: config.campaignChannelIds,
    sinceSeq
  }, db);
}

export async function getActiveCheckpoint(guildId) {
  const state = await stateRepo.getState(guildId);
  return state && state.version > 0 ? state : null;
}

export function listCheckpointVersions(guildId) {
  return checkpointRepo.listVersions(guildId, CHECKPOINT_VERSIONS_LIST_LIMIT);
}

/**
 * Summarizes main-adventure history since the last boundary into a new
 * draft checkpoint. The draft is discarded if the campaign moves on while
 * the model is generating it.
 */
export async function createCheckpointDraft({ guildId, authorId }) {
  const state = await stateRepo.getState(guildId);

  // Snapshot the high-water mark before calling the model. The draft covers
  // exactly the messages in (state.boundary_seq, boundarySeq].
  const [boundarySeq, boundaryAt] = await Promise.all([
    getHighWaterSeq(guildId),
    getDatabaseTime()
  ]);

  const [legacy, mainHistory, players, npcs, boundaryMessageId] =
    await Promise.all([
      state.version === 0 ? getCampaignLegacyCheckpoint(guildId) : null,
      getHistory({
        guildId,
        channelId: config.channels.main,
        timelineId: state.timeline_id,
        afterSeq: state.boundary_seq,
        untilSeq: boundarySeq
      }),
      getPlayers(guildId),
      getNpcs(guildId),
      getLatestMessageId({
        guildId,
        channelId: config.channels.main,
        timelineId: state.timeline_id,
        untilSeq: boundarySeq
      })
    ]);

  const checkpoint = await generateCheckpoint({
    current_version: state.version,
    active_checkpoint: state.version > 0 ? state.checkpoint : null,
    legacy_kraavok: legacy,
    active_main_history: mainHistory,
    players: players.map(toCharacterSummary),
    npc_public_information: npcs.map(toPublicNpc)
  });

  const latestState = await stateRepo.getState(guildId);

  if (
    latestState.version !== state.version ||
    latestState.timeline_id !== state.timeline_id
  ) {
    throw new UserFacingError('Campaign changed during draft generation. Retry.');
  }

  if (await campaignChangedAfter(guildId, state.timeline_id, boundarySeq)) {
    throw new UserFacingError(
      'New campaign messages arrived during draft generation. Retry.'
    );
  }

  await checkpointRepo.upsertDraft({
    guildId,
    checkpoint,
    basedOnVersion: state.version,
    createdBy: authorId,
    timelineId: state.timeline_id,
    boundaryMessageId,
    boundaryAt,
    boundarySeq
  });

  return { checkpoint, basedOnVersion: state.version };
}

/** Promotes the guild's draft to the active checkpoint. Returns the new version. */
export function confirmCheckpointDraft({ guildId, userId }) {
  return withGuildTransaction(guildId, async db => {
    const draft = await checkpointRepo.getDraftForUpdate(db, guildId);

    if (!draft) {
      throw new UserFacingError('No checkpoint draft exists.');
    }

    if (draft.created_by !== userId) {
      throw new UserFacingError('Only the draft creator can confirm it.');
    }

    const state = await stateRepo.getStateForUpdate(db, guildId);

    if (
      !state ||
      state.version !== draft.based_on_version ||
      state.timeline_id !== draft.timeline_id
    ) {
      throw new UserFacingError(
        'Campaign checkpoint or timeline changed. Create a new draft.'
      );
    }

    if (await campaignChangedAfter(guildId, state.timeline_id, draft.boundary_seq, db)) {
      throw new UserFacingError(
        'New campaign messages arrived after the draft. ' +
        'Use /checkpoint save again.'
      );
    }

    const version = state.version + 1;

    await stateRepo.advanceCheckpoint(db, {
      guildId,
      checkpoint: draft.checkpoint,
      version,
      boundaryAt: draft.boundary_at,
      boundarySeq: draft.boundary_seq
    });

    await checkpointRepo.insertVersion(db, {
      guildId,
      version,
      checkpoint: draft.checkpoint,
      createdBy: userId,
      reason: 'save',
      timelineId: state.timeline_id,
      boundaryMessageId: draft.boundary_message_id,
      boundaryAt: draft.boundary_at,
      boundarySeq: draft.boundary_seq
    });

    await checkpointRepo.deleteDraft(guildId, db);

    return { version };
  });
}

/**
 * Restores an earlier checkpoint as a new version on a fresh timeline.
 * Messages from the abandoned timeline stay stored but are no longer read.
 */
export function rollbackCheckpoint({ guildId, userId, targetVersion }) {
  return withGuildTransaction(guildId, async db => {
    const state = await stateRepo.getStateForUpdate(db, guildId);

    if (!state || state.version === 0) {
      throw new UserFacingError('No saved checkpoint exists.');
    }

    if (
      !Number.isSafeInteger(targetVersion) ||
      targetVersion < 1 ||
      targetVersion > state.version
    ) {
      throw new UserFacingError('Invalid checkpoint version.');
    }

    const target = await checkpointRepo.getVersion(guildId, targetVersion, db);

    if (!target) {
      throw new UserFacingError(`Checkpoint v${targetVersion} not found.`);
    }

    const version = state.version + 1;
    const timelineId = randomUUID();

    await stateRepo.resetToTimeline(db, {
      guildId,
      checkpoint: target.checkpoint,
      version,
      timelineId
    });

    await checkpointRepo.insertVersion(db, {
      guildId,
      version,
      checkpoint: target.checkpoint,
      createdBy: userId,
      reason: `rollback to v${targetVersion}`,
      timelineId
    });

    await checkpointRepo.deleteDraft(guildId, db);

    return { restoredVersion: targetVersion, version, timelineId };
  });
}

/** Returns true if the user's draft was removed. */
export function cancelCheckpointDraft({ guildId, userId }) {
  return checkpointRepo.deleteDraftOwnedBy(guildId, userId);
}
