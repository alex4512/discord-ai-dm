// Player characters the campaign registry must contain at startup.
export const REQUIRED_CHARACTERS = Object.freeze(['Kraavok', 'Looming Shade']);

// Owner of the pre-versioning (v0) checkpoint stored in campaign_checkpoints.
export const LEGACY_CHECKPOINT_CHARACTER = 'Kraavok';

// Discord hard limit is 2000 chars; leave headroom for formatting.
export const DISCORD_CHUNK_SIZE = 1850;

export const CHECKPOINT_VERSIONS_LIST_LIMIT = 20;
