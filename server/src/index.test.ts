import { describe, it, expect } from 'vitest';
import { createServer } from './index';
import type { Config } from './config';

const config: Config = {
  botToken: '123456:TEST-TOKEN',
  adminTelegramId: '1',
  groupChatId: '-1001',
  geminiBackend: 'api',
  geminiApiKey: 'fake-key',
  geminiModel: 'gemini-3.5-flash',
  agyPath: 'agy',
  agyTimeoutMs: 180000,
  dbPath: ':memory:',
  port: 0,
  publicUrl: 'https://example.com',
  devNoTelegram: false,
  devAdminName: '',
  miniAppLink: 'https://t.me/testbot/order',
  botInfo: {
    id: 123456,
    is_bot: true,
    first_name: 'TestBot',
    can_join_groups: true,
    can_read_all_group_messages: false,
    supports_inline_queries: false,
    username: 'testbot',
    can_connect_to_business: false,
    has_main_web_app: false,
    has_topics_enabled: false,
    allows_users_to_create_topics: false,
    can_manage_bots: false,
    supports_join_request_queries: false,
  },
};

describe('createServer', () => {
  it('wires the app together and serves the health check without hitting the network', async () => {
    const { app } = createServer(config);
    const res = await app.inject({ method: 'GET', url: '/api/health' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ status: 'ok' });
  });

  it('registers a POST /telegram/webhook route for the bot', async () => {
    const { app } = createServer(config);
    const res = await app.inject({ method: 'POST', url: '/telegram/webhook', payload: {} });
    expect(res.statusCode).not.toBe(404);
  });

  it('boots without a bot token in dev mode, and then has no webhook to serve', async () => {
    const { app, bot } = createServer({
      ...config,
      botToken: '',
      geminiApiKey: '',
      botInfo: undefined,
      devNoTelegram: true,
    });
    expect(bot).toBeNull();

    expect((await app.inject({ method: 'GET', url: '/api/health' })).statusCode).toBe(200);
    const webhook = await app.inject({ method: 'POST', url: '/telegram/webhook', payload: {} });
    expect(webhook.statusCode).toBe(404);
  });

  it('lets a dev user in by name and serves them as admin', async () => {
    const { app } = createServer({ ...config, botToken: '', botInfo: undefined, devNoTelegram: true });
    const res = await app.inject({
      method: 'GET',
      url: '/api/me',
      headers: { 'x-dev-user': 'Ann' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ displayName: 'Ann', role: 'admin' });
  });
});
