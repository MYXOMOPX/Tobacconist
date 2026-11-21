import { describe, it, expect } from 'vitest';
import { loadConfig } from './config';

const prodEnv = {
  BOT_TOKEN: '123:abc',
  TELEGRAM_ADMIN_ID: '1',
  GEMINI_API_KEY: 'key',
  PUBLIC_URL: 'https://example.com',
};

describe('loadConfig', () => {
  it('demands every Telegram and Gemini variable by default', () => {
    expect(() => loadConfig({ ...prodEnv, BOT_TOKEN: undefined })).toThrow('BOT_TOKEN');
    expect(() => loadConfig({ ...prodEnv, GEMINI_API_KEY: undefined })).toThrow('GEMINI_API_KEY');
    expect(loadConfig(prodEnv)).toMatchObject({ devNoTelegram: false, botToken: '123:abc' });
  });

  it('starts without a chat id in the environment', () => {
    const config = loadConfig(prodEnv);
    expect(config.botToken).toBe('123:abc');
    expect(config).not.toHaveProperty('groupChatId');
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

  it('defaults to the API backend and the 3.5 flash model', () => {
    expect(loadConfig(prodEnv)).toMatchObject({
      geminiBackend: 'api',
      geminiModel: 'gemini-3.5-flash',
      agyPath: 'agy',
      agyTimeoutMs: 180000,
    });
  });

  it('runs on agy without an API key, with its own default model', () => {
    const config = loadConfig({ ...prodEnv, GEMINI_API_KEY: undefined, GEMINI_BACKEND: 'agy' });
    expect(config).toMatchObject({ geminiBackend: 'agy', geminiApiKey: '' });
    expect(config.geminiModel).toMatch(/^gemini-3\./);
  });

  it('lets the model, the agy path and its timeout be set', () => {
    expect(
      loadConfig({
        ...prodEnv,
        GEMINI_BACKEND: 'agy',
        GEMINI_MODEL: 'gemini-3.8-flash-high',
        AGY_PATH: '/opt/agy',
        AGY_TIMEOUT_SECONDS: '60',
      })
    ).toMatchObject({ geminiModel: 'gemini-3.8-flash-high', agyPath: '/opt/agy', agyTimeoutMs: 60000 });
  });

  it('refuses an unknown backend instead of silently using the API', () => {
    expect(() => loadConfig({ ...prodEnv, GEMINI_BACKEND: 'agi' })).toThrow('GEMINI_BACKEND');
  });
});
