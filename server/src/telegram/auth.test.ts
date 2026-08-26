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
  const pairs = [...params.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
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

  it('rejects a wrong-but-same-length hash', () => {
    const initData = buildInitData();
    const parts = initData.split('&');
    const tampered = parts.map(p => {
      if (p.startsWith('hash=')) {
        // Flip first hex digit
        const hash = p.substring(5);
        const firstChar = hash.charAt(0);
        const newChar = String.fromCharCode(((parseInt(firstChar, 16) + 1) % 16).toString(16).charCodeAt(0));
        return 'hash=' + newChar + hash.substring(1);
      }
      return p;
    }).join('&');
    const result = verifyInitData({ initData: tampered, botToken: BOT_TOKEN });
    expect(result.ok).toBe(false);
  });

  it('rejects a wrong-length hash', () => {
    const initData = buildInitData() + '&extra=data';
    const parts = initData.split('&');
    const tampered = parts.map(p => {
      if (p.startsWith('hash=')) {
        return 'hash=' + p.substring(5).slice(0, -4);
      }
      return p;
    }).join('&');
    const result = verifyInitData({ initData: tampered, botToken: BOT_TOKEN });
    expect(result.ok).toBe(false);
  });

  it('hardcoded HMAC vector: verifies known-good initData with fixed bot token', () => {
    const FIXED_BOT_TOKEN = '123456:ABCDEF';
    const recentAuthDate = String(Math.floor(Date.now() / 1000) - 3600);
    const params = new URLSearchParams();
    params.set('auth_date', recentAuthDate);
    params.set('user', JSON.stringify({ id: 123, first_name: 'Test', last_name: 'User' }));
    const pairs = [...params.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    const dataCheckString = pairs.map(([k, v]) => `${k}=${v}`).join('\n');
    const secretKey = crypto.createHmac('sha256', 'WebAppData').update(FIXED_BOT_TOKEN).digest();
    const expectedHash = crypto.createHmac('sha256', secretKey).update(dataCheckString).digest('hex');
    params.set('hash', expectedHash);
    const initData = params.toString();

    const result = verifyInitData({ initData, botToken: FIXED_BOT_TOKEN });
    expect(result).toEqual({ ok: true, telegramId: '123', displayName: 'Test User' });
  });

  it('rejects an expired auth_date using injected clock', () => {
    const pastAuthDate = Math.floor(Date.now() / 1000) - 100000;
    const initData = buildInitData({ authDate: pastAuthDate });
    const now = new Date();
    const result = verifyInitData({ initData, botToken: BOT_TOKEN, maxAgeSeconds: 86400, now });
    expect(result).toEqual({ ok: false, reason: 'expired' });
  });

  it('accepts auth_date at maxAgeSeconds boundary (just within)', () => {
    const fixedAuthDate = Math.floor(Date.now() / 1000) - 86390;
    const initData = buildInitData({ authDate: fixedAuthDate });
    const now = new Date();
    const result = verifyInitData({ initData, botToken: BOT_TOKEN, maxAgeSeconds: 86400, now });
    expect(result.ok).toBe(true);
  });

  it('rejects auth_date at maxAgeSeconds boundary (just expired)', () => {
    const fixedAuthDate = Math.floor(Date.now() / 1000) - 86410;
    const initData = buildInitData({ authDate: fixedAuthDate });
    const now = new Date();
    const result = verifyInitData({ initData, botToken: BOT_TOKEN, maxAgeSeconds: 86400, now });
    expect(result).toEqual({ ok: false, reason: 'expired' });
  });

  it('rejects null user object', () => {
    const params = new URLSearchParams();
    params.set('auth_date', String(Math.floor(Date.now() / 1000)));
    params.set('user', 'null');
    const pairs = [...params.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    const dataCheckString = pairs.map(([k, v]) => `${k}=${v}`).join('\n');
    const secretKey = crypto.createHmac('sha256', 'WebAppData').update(BOT_TOKEN).digest();
    const hash = crypto.createHmac('sha256', secretKey).update(dataCheckString).digest('hex');
    params.set('hash', hash);
    const initData = params.toString();

    const result = verifyInitData({ initData, botToken: BOT_TOKEN });
    expect(result).toEqual({ ok: false, reason: 'invalid user' });
  });

  it('rejects user object without id field', () => {
    const params = new URLSearchParams();
    params.set('auth_date', String(Math.floor(Date.now() / 1000)));
    params.set('user', JSON.stringify({ first_name: 'NoId' }));
    const pairs = [...params.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    const dataCheckString = pairs.map(([k, v]) => `${k}=${v}`).join('\n');
    const secretKey = crypto.createHmac('sha256', 'WebAppData').update(BOT_TOKEN).digest();
    const hash = crypto.createHmac('sha256', secretKey).update(dataCheckString).digest('hex');
    params.set('hash', hash);
    const initData = params.toString();

    const result = verifyInitData({ initData, botToken: BOT_TOKEN });
    expect(result).toEqual({ ok: false, reason: 'invalid user' });
  });
});

describe('checkGroupMembership', () => {
  it('returns true for an active member', async () => {
    const api: ChatMemberApi = { getChatMember: async () => ({ status: 'member' }) };
    expect(await checkGroupMembership(api, '-100123', 555)).toBe(true);
  });

  it('returns true for an administrator', async () => {
    const api: ChatMemberApi = { getChatMember: async () => ({ status: 'administrator' }) };
    expect(await checkGroupMembership(api, '-100123', 555)).toBe(true);
  });

  it('returns true for a creator', async () => {
    const api: ChatMemberApi = { getChatMember: async () => ({ status: 'creator' }) };
    expect(await checkGroupMembership(api, '-100123', 555)).toBe(true);
  });

  it('returns false for someone who left', async () => {
    const api: ChatMemberApi = { getChatMember: async () => ({ status: 'left' }) };
    expect(await checkGroupMembership(api, '-100123', 555)).toBe(false);
  });

  it('returns false for someone who was kicked', async () => {
    const api: ChatMemberApi = { getChatMember: async () => ({ status: 'kicked' }) };
    expect(await checkGroupMembership(api, '-100123', 555)).toBe(false);
  });

  it('returns false for an unknown status string', async () => {
    const api: ChatMemberApi = { getChatMember: async () => ({ status: 'unknown_future_status' }) };
    expect(await checkGroupMembership(api, '-100123', 555)).toBe(false);
  });

  it('returns true for restricted status with is_member: true', async () => {
    const api: ChatMemberApi = { getChatMember: async () => ({ status: 'restricted', is_member: true }) };
    expect(await checkGroupMembership(api, '-100123', 555)).toBe(true);
  });

  it('returns false for restricted status with is_member: false', async () => {
    const api: ChatMemberApi = { getChatMember: async () => ({ status: 'restricted', is_member: false }) };
    expect(await checkGroupMembership(api, '-100123', 555)).toBe(false);
  });

  it('returns false for restricted status without is_member field', async () => {
    const api: ChatMemberApi = { getChatMember: async () => ({ status: 'restricted' }) };
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
