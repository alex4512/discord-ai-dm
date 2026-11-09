// Snapshot partitions stored side by side on campaign_state,
// campaign_checkpoint_versions and campaign_checkpoint_drafts
// (docs/DECISIONS.md D-001, D-007). Adding a partition = a migration that
// adds the JSONB column to all three tables + an entry here.
export const PARTITIONS = Object.freeze([
  'checkpoint',
  'character_knowledge',
  'dm_notes',
  'npcs'
]);

// Value used when a row predates a partition (column is NULL).
export const PARTITION_DEFAULTS = Object.freeze({
  checkpoint: null,
  character_knowledge: {},
  dm_notes: null,
  npcs: {}
});

/** The partitions of a state/draft/version row, NULLs replaced by defaults. */
export function toSnapshot(row) {
  return Object.fromEntries(
    PARTITIONS.map(name => [name, row[name] ?? PARTITION_DEFAULTS[name]])
  );
}

export const PARTITION_COLUMNS = PARTITIONS.join(', ');

/** `checkpoint = $2, character_knowledge = $3, ...` starting at `$first`. */
export function partitionAssignments(first) {
  return PARTITIONS.map((name, i) => `${name} = $${first + i}`).join(',\n        ');
}

/** `$2, $3, ...` placeholders for the partitions starting at `$first`. */
export function partitionPlaceholders(first) {
  return PARTITIONS.map((_, i) => `$${first + i}`).join(', ');
}

export const partitionValues = snapshot => PARTITIONS.map(name => snapshot[name]);
