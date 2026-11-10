import { getState } from '../db/repositories/stateRepository.js';
import { insertEvents, listEvents } from '../db/repositories/inventoryRepository.js';
import { toSnapshot } from '../db/partitions.js';
import { applyEvents, planLoot } from './loot.js';

/**
 * Inventory kept by the bot (D-022), built like XP (D-014):
 * current inventory = the saved `inventory` partition + ledger events on
 * the active timeline after the checkpoint boundary, in seq order.
 */

/** Current inventory for an already loaded state row. */
export async function currentInventory(guildId, state) {
  const events = await listEvents({
    guildId,
    timelineId: state.timeline_id,
    afterSeq: state.boundary_seq
  });
  return applyEvents(toSnapshot(state).inventory, events);
}

/** The `inventory` partition for a save covering (previous boundary, untilSeq]. */
export async function foldInventory({ guildId, state, untilSeq }) {
  const events = await listEvents({
    guildId,
    timelineId: state.timeline_id,
    afterSeq: state.boundary_seq,
    untilSeq
  });
  return applyEvents(toSnapshot(state).inventory, events);
}

/**
 * Checks parsed loot operations against the current inventory and records
 * the accepted ones. `context` is planLoot's ({ kind, characterName }).
 * With `dryRun` (test mode) nothing is written.
 * Returns { applied, refused }.
 */
export async function recordLoot({ guildId, channelId, userId, ops, context, dryRun = false }) {
  if (!ops.length) return { applied: [], refused: [] };

  const state = await getState(guildId);
  const inventory = await currentInventory(guildId, state);
  const { events, applied, refused } = planLoot(ops, inventory, context);

  if (!dryRun && events.length) {
    await insertEvents({
      guildId,
      timelineId: state.timeline_id,
      channelId,
      createdBy: userId,
      events
    });
  }
  return { applied, refused };
}
