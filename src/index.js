import { Events } from 'discord.js';
import { config } from './config.js';
import { pool } from './db/pool.js';
import { verifySchema } from './db/schema.js';
import { initializeCampaign } from './services/campaignService.js';
import { createDiscordClient } from './discord/client.js';
import { onMessageCreate } from './discord/handlers/messageCreate.js';

async function main() {
  await verifySchema();
  await initializeCampaign(config.discord.guildId);
  console.log('Database initialized successfully');

  const client = createDiscordClient();

  client.once(Events.ClientReady, readyClient => {
    console.log(`Dungeon Master online as ${readyClient.user.tag}`);
    console.log(`OpenAI model: ${config.openai.model}`);
  });

  client.on(Events.MessageCreate, onMessageCreate);

  const shutdown = async signal => {
    console.log(`Received ${signal}, shutting down...`);
    await client.destroy();
    await pool.end();
    process.exit(0);
  };

  process.once('SIGINT', shutdown);
  process.once('SIGTERM', shutdown);

  await client.login(config.discord.token);
}

try {
  await main();
} catch (error) {
  console.error('Startup failed:', error);
  await pool.end();
  process.exitCode = 1;
}
