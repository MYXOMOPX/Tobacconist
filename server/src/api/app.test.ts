import { describe, it, expect, vi } from 'vitest';
import { createTestDb } from '../db/client';
import { buildApp } from './app';
import type { ChatMemberApi } from '../telegram/auth';
import type { GeminiClient } from '../gemini/client';
import type { DocumentSender } from '../telegram/notify';

describe('buildApp', () => {
  it('exposes GET /api/health without requiring auth', async () => {
    const chatMemberApi: ChatMemberApi = { getChatMember: async () => ({ status: 'member' }) };
    const geminiClient: GeminiClient = { generateFromImage: async () => '[]' };
    const documentSender: DocumentSender = { sendDocument: vi.fn() };
    const app = buildApp({
      db: createTestDb(),
      botToken: 'x',
      groupChatId: '-1001',
      adminTelegramId: '1',
      chatMemberApi,
      geminiClient,
      uploadsDir: '/tmp/uploads',
      documentSender,
    });
    const res = await app.inject({ method: 'GET', url: '/api/health' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ status: 'ok' });
  });

  it('requires auth for routes registered inside the /api context', async () => {
    const chatMemberApi: ChatMemberApi = { getChatMember: async () => ({ status: 'member' }) };
    const geminiClient: GeminiClient = { generateFromImage: async () => '[]' };
    const documentSender: DocumentSender = { sendDocument: vi.fn() };
    const app = buildApp({
      db: createTestDb(),
      botToken: 'x',
      groupChatId: '-1001',
      adminTelegramId: '1',
      chatMemberApi,
      geminiClient,
      uploadsDir: '/tmp/uploads',
      documentSender,
      onApiReady: async (api) => {
        api.get('/test-protected', async () => ({ ok: true }));
      },
    });
    const res = await app.inject({ method: 'GET', url: '/api/test-protected' });
    // Should be 401 because no auth header was provided
    expect(res.statusCode).toBe(401);
  });
});
