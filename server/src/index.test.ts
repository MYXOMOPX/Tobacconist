import { describe, it, expect } from 'vitest';
import { createServer } from './index';
import type { Config } from './config';

const config: Config = {
  botToken: '123456:TEST-TOKEN',
  adminTelegramId: '1',
  groupChatId: '-1001',
  geminiApiKey: 'fake-key',
  dbPath: ':memory:',
  port: 0,
  publicUrl: 'https://example.com',
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
});
