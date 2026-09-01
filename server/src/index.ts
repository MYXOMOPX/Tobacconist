import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { webhookCallback } from 'grammy';
import { loadConfig, type Config } from './config.js';
import { createDb } from './db/client.js';
import { createGeminiClient } from './gemini/client.js';
import { createBot } from './telegram/bot.js';
import { createLoggingOrderAnnouncer, createOrderAnnouncer } from './telegram/notify.js';
import type { ChatMemberApi } from './telegram/auth.js';
import { buildApp } from './api/app.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** Nothing asks it anything in dev mode — authentication never gets that far. */
const devChatMemberApi: ChatMemberApi = {
  async getChatMember() {
    return { status: 'member' };
  },
};

export function createServer(config: Config) {
  const db = createDb(config.dbPath);
  const geminiClient = createGeminiClient(config.geminiApiKey, config.geminiModel);
  // Without a bot token there is no bot to build, so dev mode goes without one:
  // no webhook, and announcements only reach the log.
  const bot = config.devNoTelegram
    ? null
    : createBot({
        botToken: config.botToken,
        db,
        adminTelegramId: config.adminTelegramId,
        groupChatId: config.groupChatId,
        miniAppLink: config.miniAppLink,
        botInfo: config.botInfo,
      });
  const orderAnnouncer = bot
    ? createOrderAnnouncer({
        sender: bot.api,
        groupChatId: config.groupChatId,
        miniAppLink: config.miniAppLink,
      })
    : createLoggingOrderAnnouncer();

  const app = buildApp({
    db,
    botToken: config.botToken,
    groupChatId: config.groupChatId,
    adminTelegramId: config.adminTelegramId,
    chatMemberApi: bot ? bot.api : devChatMemberApi,
    geminiClient,
    uploadsDir: path.join(path.dirname(config.dbPath === ':memory:' ? '.' : config.dbPath), 'uploads'),
    orderAnnouncer,
    dev: config.devNoTelegram ? { adminName: config.devAdminName } : undefined,
    miniAppDistPath: path.resolve(__dirname, '../../mini-app/dist'),
  });

  if (bot) {
    app.post('/telegram/webhook', webhookCallback(bot, 'fastify'));
  }

  return { app, bot, db };
}

export async function main() {
  const config = loadConfig();
  const { app, bot } = createServer(config);
  if (bot) {
    await bot.api.setWebhook(`${config.publicUrl}/telegram/webhook`);
    if (!config.miniAppLink) {
      console.warn(
        'TELEGRAM_MINIAPP_LINK is not set — group announcements will go out without the "open the order" button'
      );
    }
  } else {
    console.log('[dev] DEV_NO_TELEGRAM=true — no bot, no webhook, identity from X-Dev-User');
    if (!config.geminiApiKey) {
      console.log('[dev] no GEMINI_API_KEY — everything works except reading price screenshots');
    }
  }
  await app.listen({ port: config.port, host: '0.0.0.0' });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
