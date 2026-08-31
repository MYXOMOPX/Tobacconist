import { describe, it, expect } from 'vitest';
import { loadConfig } from './config';

const prodEnv = {
  BOT_TOKEN: '123:abc',
  TELEGRAM_ADMIN_ID: '1',
  TELEGRAM_GROUP_CHAT_ID: '-1001',
  GEMINI_API_KEY: 'key',
  PUBLIC_URL: 'https://example.com',
};

describe('loadConfig', () => {
  it('demands every Telegram and Gemini variable by default', () => {
    expect(() => loadConfig({ ...prodEnv, BOT_TOKEN: undefined })).toThrow('BOT_TOKEN');
    expect(() => loadConfig({ ...prodEnv, GEMINI_API_KEY: undefined })).toThrow('GEMINI_API_KEY');
    expect(loadConfig(prodEnv)).toMatchObject({ devNoTelegram: false, botToken: '123:abc' });
  });

  it('asks for nothing external in dev mode and falls back to a local url', () => {
    const config = loadConfig({ DEV_NO_TELEGRAM: 'true', PORT: '4000' });
    expect(config).toMatchObject({
      devNoTelegram: true,
      botToken: '',
      geminiApiKey: '',
      publicUrl: 'http://localhost:4000',
      devAdminName: '',
    });
  });

  it('only trusts the literal true, so a stray value cannot open the server up', () => {
    expect(() => loadConfig({ DEV_NO_TELEGRAM: '1' })).toThrow('BOT_TOKEN');
  });

  it('carries DEV_ADMIN_NAME through', () => {
    expect(loadConfig({ DEV_NO_TELEGRAM: 'true', DEV_ADMIN_NAME: 'Ann' })).toMatchObject({
      devAdminName: 'Ann',
    });
  });
});
