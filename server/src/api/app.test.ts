import { describe, it, expect, vi } from 'vitest';
import { Writable } from 'node:stream';
import { createTestDb } from '../db/client';
import { buildApp } from './app';
import type { ChatMemberApi } from '../telegram/auth';
import type { GeminiClient } from '../gemini/client';
import type { OrderAnnouncer } from '../telegram/notify';

describe('buildApp', () => {
  it('exposes GET /api/health without requiring auth', async () => {
    const chatMemberApi: ChatMemberApi = { getChatMember: async () => ({ status: 'member' }) };
    const geminiClient: GeminiClient = { generateFromImage: async () => '[]' };
    const orderAnnouncer: OrderAnnouncer = { announceOrderOpened: vi.fn(), announceStatusChanged: vi.fn() };
    const app = buildApp({
      db: createTestDb(),
      botToken: 'x',
      groupChatId: '-1001',
      adminTelegramId: '1',
      chatMemberApi,
      geminiClient,
      uploadsDir: '/tmp/uploads',
      orderAnnouncer,
    });
    const res = await app.inject({ method: 'GET', url: '/api/health' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ status: 'ok' });
  });

  it('requires auth for routes registered inside the /api context', async () => {
    const chatMemberApi: ChatMemberApi = { getChatMember: async () => ({ status: 'member' }) };
    const geminiClient: GeminiClient = { generateFromImage: async () => '[]' };
    const orderAnnouncer: OrderAnnouncer = { announceOrderOpened: vi.fn(), announceStatusChanged: vi.fn() };
    const app = buildApp({
      db: createTestDb(),
      botToken: 'x',
      groupChatId: '-1001',
      adminTelegramId: '1',
      chatMemberApi,
      geminiClient,
      uploadsDir: '/tmp/uploads',
      orderAnnouncer,
      onApiReady: async (api) => {
        api.get('/test-protected', async () => ({ ok: true }));
      },
    });
    const res = await app.inject({ method: 'GET', url: '/api/test-protected' });
    // Should be 401 because no auth header was provided
    expect(res.statusCode).toBe(401);
  });

  it('logs unexpected errors handled by the custom error handler', async () => {
    const chatMemberApi: ChatMemberApi = { getChatMember: async () => ({ status: 'member' }) };
    const geminiClient: GeminiClient = { generateFromImage: async () => '[]' };
    const orderAnnouncer: OrderAnnouncer = { announceOrderOpened: vi.fn(), announceStatusChanged: vi.fn() };
    const lines: string[] = [];
    const stream = new Writable({
      write(chunk, _enc, cb) {
        lines.push(String(chunk));
        cb();
      },
    });
    const app = buildApp({
      db: createTestDb(),
      botToken: 'x',
      groupChatId: '-1001',
      adminTelegramId: '1',
      chatMemberApi,
      geminiClient,
      uploadsDir: '/tmp/uploads',
      orderAnnouncer,
      logger: { stream },
    });
    // Registered outside the authenticated /api context so the error handler is
    // reached without needing signed init data.
    app.get('/boom', async () => {
      throw new Error('kaboom');
    });

    const res = await app.inject({ method: 'GET', url: '/boom' });

    expect(res.statusCode).toBe(400);
    const logged = lines.find((l) => l.includes('unhandled error'));
    expect(logged, `expected an error log line, got: ${lines.join('')}`).toBeDefined();
    expect(logged).toContain('"level":50');
    expect(logged).toContain('kaboom');
  });
});
