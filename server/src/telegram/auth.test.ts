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
    const initData = buildInitData();
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

  it('rejects a hash with trailing garbage characters', () => {
    const initData = buildInitData();
    const parts = initData.split('&');
    const tampered = parts.map(p => {
      if (p.startsWith('hash=')) {
        return p + 'zzzz';
      }
      return p;
    }).join('&');
    const result = verifyInitData({ initData: tampered, botToken: BOT_TOKEN });
    expect(result.ok).toBe(false);
  });

  it('hardcoded HMAC vector: verifies known-good initData with fixed bot token', () => {
    // Hardcoded vector computed once with Node crypto:
    // BOT_TOKEN: 123456:ABCDEF
    // auth_date: 1600000000
    // user: {"id":99,"first_name":"Alice","last_name":"Brown"}
    // Computed hash: 08d39ca06c8d73977953ab3bcfe043f9bfc921593f9bc988fdf97709e374c60c
    const FIXED_BOT_TOKEN = '123456:ABCDEF';
    const HARDCODED_INIT_DATA = 'auth_date=1600000000&user=%7B%22id%22%3A99%2C%22first_name%22%3A%22Alice%22%2C%22last_name%22%3A%22Brown%22%7D&hash=08d39ca06c8d73977953ab3bcfe043f9bfc921593f9bc988fdf97709e374c60c';
    const HARDCODED_HASH = '08d39ca06c8d73977953ab3bcfe043f9bfc921593f9bc988fdf97709e374c60c';
    // Set 'now' to be 1 hour after the auth_date, well within the 24-hour window
    const nowTime = new Date((1600000000 + 3600) * 1000);

    const result = verifyInitData({ initData: HARDCODED_INIT_DATA, botToken: FIXED_BOT_TOKEN, now: nowTime });
    expect(result).toEqual({ ok: true, telegramId: '99', displayName: 'Alice Brown' });
    // Verify the hash is exactly what we hardcoded
    const decoded = new URLSearchParams(HARDCODED_INIT_DATA);
    expect(decoded.get('hash')).toBe(HARDCODED_HASH);
  });

  it('rejects an expired auth_date using injected clock', () => {
    const pastAuthDate = Math.floor(Date.now() / 1000) - 100000;
    const initData = buildInitData({ authDate: pastAuthDate });
    const now = new Date();
    const result = verifyInitData({ initData, botToken: BOT_TOKEN, maxAgeSeconds: 86400, now });
    expect(result).toEqual({ ok: false, reason: 'expired' });
  });

  it('accepts auth_date at maxAgeSeconds boundary (just within)', () => {
    // Fixed timestamp: auth_date is exactly at the maxAgeSeconds boundary
    // Comparison: now - authDate > maxAgeSeconds?
    // At boundary: 86400 - 86400 = 0, which is NOT > 86400, so should pass
    const fixedAuthDate = 1600000000;
    const maxAgeSeconds = 86400;
    const nowAtBoundary = new Date((fixedAuthDate + maxAgeSeconds) * 1000);
    const initData = buildInitData({ authDate: fixedAuthDate });
    const result = verifyInitData({ initData, botToken: BOT_TOKEN, maxAgeSeconds, now: nowAtBoundary });
    expect(result.ok).toBe(true);
  });

  it('rejects auth_date at maxAgeSeconds boundary (just expired)', () => {
    // Just past boundary: one second over maxAgeSeconds
    // Comparison: 86401 - 0 = 86401, which IS > 86400, so should fail
    const fixedAuthDate = 1600000000;
    const maxAgeSeconds = 86400;
    const nowPastBoundary = new Date((fixedAuthDate + maxAgeSeconds + 1) * 1000);
    const initData = buildInitData({ authDate: fixedAuthDate });
    const result = verifyInitData({ initData, botToken: BOT_TOKEN, maxAgeSeconds, now: nowPastBoundary });
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
