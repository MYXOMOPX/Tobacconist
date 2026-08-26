export type Config = {
  botToken: string;
  adminTelegramId: string;
  groupChatId: string;
  geminiApiKey: string;
  dbPath: string;
  port: number;
  publicUrl: string;
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
    dbPath: env.DB_PATH ?? './data/tobacconist.sqlite3',
    port: Number(env.PORT ?? 3000),
    publicUrl: required('PUBLIC_URL'),
  };
}
