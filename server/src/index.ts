import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { webhookCallback } from 'grammy';
import { loadConfig, type Config } from './config.js';
import { createDb } from './db/client.js';
import { createGeminiClient } from './gemini/client.js';
import { createBot } from './telegram/bot.js';
import { createDocumentSender, createOrderAnnouncer } from './telegram/notify.js';
import { buildApp } from './api/app.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export function createServer(config: Config) {
  const db = createDb(config.dbPath);
  const geminiClient = createGeminiClient(config.geminiApiKey, config.geminiModel);
  const bot = createBot({
    botToken: config.botToken,
    db,
    adminTelegramId: config.adminTelegramId,
    groupChatId: config.groupChatId,
    miniAppUrl: config.publicUrl,
    botInfo: config.botInfo,
  });
  const documentSender = createDocumentSender(bot);
  const orderAnnouncer = createOrderAnnouncer({
    sender: bot.api,
    groupChatId: config.groupChatId,
    miniAppUrl: config.publicUrl,
  });

  const app = buildApp({
    db,
    botToken: config.botToken,
    groupChatId: config.groupChatId,
    adminTelegramId: config.adminTelegramId,
    chatMemberApi: bot.api,
    geminiClient,
    uploadsDir: path.join(path.dirname(config.dbPath === ':memory:' ? '.' : config.dbPath), 'uploads'),
    documentSender,
    orderAnnouncer,
    miniAppDistPath: path.resolve(__dirname, '../../mini-app/dist'),
  });

  app.post('/telegram/webhook', webhookCallback(bot, 'fastify'));

  return { app, bot, db };
}

export async function main() {
  const config = loadConfig();
  const { app, bot } = createServer(config);
  await bot.api.setWebhook(`${config.publicUrl}/telegram/webhook`);
  await app.listen({ port: config.port, host: '0.0.0.0' });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
