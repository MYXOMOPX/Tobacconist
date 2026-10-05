import type { UserFromGetMe } from 'grammy/types';
import { DEFAULT_GEMINI_MODEL } from './gemini/client.js';
import { DEFAULT_AGY_MODEL } from './gemini/agyClient.js';

export type Config = {
  botToken: string;
  adminTelegramId: string;
  groupChatId: string;
  /** `api`: Google's API with a key. `agy`: the signed-in agy CLI, which has no key limits. */
  geminiBackend: 'api' | 'agy';
  geminiApiKey: string;
  geminiModel: string;
  /** Path of the agy executable; plain `agy` is looked up on PATH. */
  agyPath: string;
  agyTimeoutMs: number;
  dbPath: string;
  port: number;
  publicUrl: string;
  /**
   * The Mini App's direct link from BotFather, e.g. `https://t.me/mybot/order`.
   * Group announcements need it: a `web_app` button is only allowed in private
   * chats, so from the group the only one-tap way in is a t.me link Telegram
   * itself resolves. Empty means announcements go out without a button.
   */
  miniAppLink: string;
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

  const geminiBackend = env.GEMINI_BACKEND === 'agy' ? 'agy' : 'api';
  if (env.GEMINI_BACKEND && !['api', 'agy'].includes(env.GEMINI_BACKEND)) {
    throw new Error(`GEMINI_BACKEND must be "api" or "agy", got "${env.GEMINI_BACKEND}"`);
  }

  const port = Number(env.PORT ?? 3000);
  return {
    botToken: requiredUnlessDev('BOT_TOKEN'),
    adminTelegramId: requiredUnlessDev('TELEGRAM_ADMIN_ID'),
    groupChatId: requiredUnlessDev('TELEGRAM_GROUP_CHAT_ID'),
    geminiBackend,
    // The key is only needed for the API backend; agy brings its own sign-in.
    geminiApiKey: geminiBackend === 'api' ? requiredUnlessDev('GEMINI_API_KEY') : (env.GEMINI_API_KEY ?? ''),
    // Google retires model ids; overridable so a retirement needs no code release.
    // The agy CLI names its models differently (see `agy models`), so it has its own default.
    geminiModel: env.GEMINI_MODEL || (geminiBackend === 'agy' ? DEFAULT_AGY_MODEL : DEFAULT_GEMINI_MODEL),
    agyPath: env.AGY_PATH || 'agy',
    agyTimeoutMs: Number(env.AGY_TIMEOUT_SECONDS ?? 180) * 1000,
    dbPath: env.DB_PATH ?? './data/tobacconist.sqlite3',
    port,
    publicUrl: requiredUnlessDev('PUBLIC_URL', `http://localhost:${port}`),
    // Optional on purpose: an existing deploy must not refuse to boot because a
    // new variable is missing. Without it the bot still posts, just without the
    // button, and says so at startup.
    miniAppLink: (env.TELEGRAM_MINIAPP_LINK ?? '').replace(/\/+$/, ''),
    devNoTelegram,
    devAdminName: env.DEV_ADMIN_NAME ?? '',
  };
}
