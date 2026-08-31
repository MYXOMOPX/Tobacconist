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
};

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  function required(key: string): string {
    const value = env[key];
    if (!value) throw new Error(`missing required env var ${key}`);
    return value;
  }
  return {
    botToken: required('BOT_TOKEN'),
    adminTelegramId: required('TELEGRAM_ADMIN_ID'),
    groupChatId: required('TELEGRAM_GROUP_CHAT_ID'),
    geminiApiKey: required('GEMINI_API_KEY'),
    // Google retires model ids; overridable so a retirement needs no code release.
    geminiModel: env.GEMINI_MODEL ?? DEFAULT_GEMINI_MODEL,
    dbPath: env.DB_PATH ?? './data/tobacconist.sqlite3',
    port: Number(env.PORT ?? 3000),
    publicUrl: required('PUBLIC_URL'),
  };
}
