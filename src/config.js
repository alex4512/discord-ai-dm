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
      model: env.OPENAI_MODEL || 'gpt-4.1-mini',
      maxOutputTokens: parsePositiveInt(env, 'MAX_OUTPUT_TOKENS', 1200),
      // Knowledge records grow over a campaign; 3500 truncated one at ~16k chars.
      checkpointMaxOutputTokens: parsePositiveInt(env, 'CHECKPOINT_MAX_OUTPUT_TOKENS', 12000)
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
