import { describe, it, expect } from 'vitest';
import crypto from 'node:crypto';
import { verifyInitData, checkGroupMembership, type ChatMemberApi } from './auth';

const BOT_TOKEN = '123456:TEST-TOKEN';

function buildInitData(overrides: { authDate?: number; user?: object } = {}) {
  const params = new URLSearchParams();
  params.set('auth_date', String(overrides.authDate ?? Math.floor(Date.now() / 1000)));
  params.set(
    'user',
    JSON.stringify(overrides.user ?? { id: 555, first_name: 'Ann', last_name: 'K' })
  );
  const pairs = [...params.entries()].sort(([a], [b]) => a.localeCompare(b));
  const dataCheckString = pairs.map(([k, v]) => `${k}=${v}`).join('\n');
  const secretKey = crypto.createHmac('sha256', 'WebAppData').update(BOT_TOKEN).digest();
  const hash = crypto.createHmac('sha256', secretKey).update(dataCheckString).digest('hex');
  params.set('hash', hash);
  return params.toString();
}

describe('verifyInitData', () => {
  it('accepts a correctly signed payload and extracts the user', () => {
    const initData = buildInitData();
    const result = verifyInitData({ initData, botToken: BOT_TOKEN });
    expect(result).toEqual({ ok: true, telegramId: '555', displayName: 'Ann K' });
  });

  it('rejects a tampered payload', () => {
    const initData = buildInitData().replace('Ann', 'Bob');
    const result = verifyInitData({ initData, botToken: BOT_TOKEN });
    expect(result.ok).toBe(false);
  });

  it('rejects an expired auth_date', () => {
    const initData = buildInitData({ authDate: Math.floor(Date.now() / 1000) - 100000 });
    const result = verifyInitData({ initData, botToken: BOT_TOKEN, maxAgeSeconds: 86400 });
    expect(result).toEqual({ ok: false, reason: 'expired' });
  });
});

describe('checkGroupMembership', () => {
  it('returns true for an active member', async () => {
    const api: ChatMemberApi = { getChatMember: async () => ({ status: 'member' }) };
    expect(await checkGroupMembership(api, '-100123', 555)).toBe(true);
  });

  it('returns false for someone who left', async () => {
    const api: ChatMemberApi = { getChatMember: async () => ({ status: 'left' }) };
    expect(await checkGroupMembership(api, '-100123', 555)).toBe(false);
  });

  it('returns false when the API call fails', async () => {
    const api: ChatMemberApi = {
      getChatMember: async () => {
        throw new Error('boom');
      },
    };
    expect(await checkGroupMembership(api, '-100123', 555)).toBe(false);
  });
});
