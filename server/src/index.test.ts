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
