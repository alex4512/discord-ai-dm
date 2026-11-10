import 'dotenv/config';

const REQUIRED_ENV = [
  'DISCORD_BOT_TOKEN',
  'OPENAI_API_KEY',
  'PGHOST',
  'PGDATABASE',
  'PGUSER',
  'PGPASSWORD',
  'DISCORD_GUILD_ID',
  'MAIN_ADVENTURE_CHANNEL_ID',
  'DM_TEST_CHANNEL_ID'
];

const DEFAULT_DM_ROLE_ID = '1569059060987199681';

function assertRequiredEnv(env) {
  const missing = REQUIRED_ENV.filter(name => !env[name]);

  if (missing.length) {
    throw new Error(`Missing environment variables: ${missing.join(', ')}`);
  }
}

function parseList(value) {
  return (value || '')
    .split(',')
    .map(item => item.trim())
    .filter(Boolean);
}

function parsePositiveInt(env, name, fallback) {
  const raw = env[name];
  if (raw === undefined || raw === '') return fallback;

  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`${name} must be a positive integer, got "${raw}"`);
  }

  return value;
}

function loadConfig(env = process.env) {
  assertRequiredEnv(env);

  // The two fixed channels. Players' private channels live in the
  // database (D-020, src/services/roster.js); the old per-player variables
  // and ALLOWED_CHANNEL_IDS are no longer read.
  const channels = {
    main: env.MAIN_ADVENTURE_CHANNEL_ID,
    test: env.DM_TEST_CHANNEL_ID
  };

  if (channels.main === channels.test) {
    throw new Error('MAIN_ADVENTURE_CHANNEL_ID and DM_TEST_CHANNEL_ID must differ');
  }

  return Object.freeze({
    discord: Object.freeze({
      token: env.DISCORD_BOT_TOKEN,
      guildId: env.DISCORD_GUILD_ID,
      dmRoleId: env.DM_ROLE_ID || DEFAULT_DM_ROLE_ID
    }),

    channels: Object.freeze(channels),

    openai: Object.freeze({
      apiKey: env.OPENAI_API_KEY,
      // Turns, maps and image prompts.
      model: env.OPENAI_MODEL || 'gpt-5.4-mini',
      // Saves decide who knows what, so they may use a stronger model (D-026).
      checkpointModel: env.CHECKPOINT_MODEL || env.OPENAI_MODEL || 'gpt-5.4',
      maxOutputTokens: parsePositiveInt(env, 'MAX_OUTPUT_TOKENS', 1200),
      // Per save call. Knowledge records grow over a campaign; 3500 truncated
      // one at ~16k chars. A save that doesn't fit fails and saves nothing.
      checkpointMaxOutputTokens: parsePositiveInt(env, 'CHECKPOINT_MAX_OUTPUT_TOKENS', 8000)
    }),

    // Cost logging and warnings (D-026). Warnings only; play never stops.
    budget: Object.freeze({
      monthlyUsd: Number(env.MONTHLY_BUDGET_USD) || 0,
      // Estimate per generated image (gpt-image-1-mini, medium, 1536x1024).
      imageCostUsd: Number(env.IMAGE_COST_USD) || 0.02
    }),

    // Scene images (D-008). Never generated automatically except once per
    // place and audience on first arrival; all generations share one cap.
    images: Object.freeze({
      model: env.IMAGE_MODEL || 'gpt-image-1-mini',
      size: env.IMAGE_SIZE || '1536x1024',
      quality: env.IMAGE_QUALITY || 'medium',
      dailyLimit: parsePositiveInt(env, 'IMAGE_DAILY_LIMIT', 10),
      style: env.IMAGE_STYLE ||
        'Painterly dark-fantasy illustration, muted earthy colours, ' +
        'atmospheric lighting, no text or lettering.'
    }),

    history: Object.freeze({
      maxChars: parsePositiveInt(env, 'HISTORY_MAX_CHARS', 18000),
      fetchLimit: 100
    }),

    postgres: Object.freeze({
      host: env.PGHOST,
      port: parsePositiveInt(env, 'PGPORT', 5432),
      database: env.PGDATABASE,
      user: env.PGUSER,
      password: env.PGPASSWORD
    })
  });
}

export const config = loadConfig();
