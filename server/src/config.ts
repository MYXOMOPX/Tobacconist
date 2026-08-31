import type { UserFromGetMe } from 'grammy/types';
import { DEFAULT_GEMINI_MODEL } from './gemini/client.js';

export type Config = {
  botToken: string;
  adminTelegramId: string;
  groupChatId: string;
  geminiApiKey: string;
  geminiModel: string;
  dbPath: string;
  port: number;
  publicUrl: string;
  botInfo?: UserFromGetMe;
  /**
   * Local debugging without Telegram: no bot, no signature check, identity comes
   * from an `X-Dev-User` header. Never turn this on anywhere reachable — it lets
   * anyone call the API as anyone, admin included.
   */
  devNoTelegram: boolean;
  /** Which `X-Dev-User` name gets the admin role. Empty: whoever logs in first. */
  devAdminName: string;
};

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const devNoTelegram = env.DEV_NO_TELEGRAM === 'true';

  function required(key: string): string {
    const value = env[key];
    if (!value) throw new Error(`missing required env var ${key}`);
    return value;
  }
  /** Telegram and Gemini are not reachable in dev mode, so their keys are not asked for. */
  function requiredUnlessDev(key: string, devFallback = ''): string {
    return devNoTelegram ? (env[key] ?? devFallback) : required(key);
  }

  const port = Number(env.PORT ?? 3000);
  return {
    botToken: requiredUnlessDev('BOT_TOKEN'),
    adminTelegramId: requiredUnlessDev('TELEGRAM_ADMIN_ID'),
    groupChatId: requiredUnlessDev('TELEGRAM_GROUP_CHAT_ID'),
    geminiApiKey: requiredUnlessDev('GEMINI_API_KEY'),
    // Google retires model ids; overridable so a retirement needs no code release.
    geminiModel: env.GEMINI_MODEL ?? DEFAULT_GEMINI_MODEL,
    dbPath: env.DB_PATH ?? './data/tobacconist.sqlite3',
    port,
    publicUrl: requiredUnlessDev('PUBLIC_URL', `http://localhost:${port}`),
    devNoTelegram,
    devAdminName: env.DEV_ADMIN_NAME ?? '',
  };
}
