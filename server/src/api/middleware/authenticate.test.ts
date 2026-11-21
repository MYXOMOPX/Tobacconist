import { describe, it, expect } from 'vitest';
import Fastify from 'fastify';
import crypto from 'node:crypto';
import { createTestDb } from '../../db/client';
import { createAuthenticate, requireAdmin } from './authenticate';
import type { ChatMemberApi } from '../../telegram/auth';
import { disallowChat } from '../../telegram/allowedChats';
import { allowedChats } from '../../db/schema';

const BOT_TOKEN = '123456:TEST-TOKEN';

function signedInitData(userId: number) {
  const params = new URLSearchParams();
  params.set('auth_date', String(Math.floor(Date.now() / 1000)));
  params.set('user', JSON.stringify({ id: userId, first_name: 'Ann' }));
  const pairs = [...params.entries()].sort(([a], [b]) => a.localeCompare(b));
  const dataCheckString = pairs.map(([k, v]) => `${k}=${v}`).join('\n');
  const secretKey = crypto.createHmac('sha256', 'WebAppData').update(BOT_TOKEN).digest();
  const hash = crypto.createHmac('sha256', secretKey).update(dataCheckString).digest('hex');
  params.set('hash', hash);
  return params.toString();
}

function buildTestApp(opts: {
  memberStatus: string;
  adminTelegramId: string;
  dev?: { adminName: string };
  allowedChatIds?: string[];
  memberChats?: string[];
}) {
  const db = createTestDb();
  for (const chatId of opts.allowedChatIds ?? ['-1001']) {
    db.insert(allowedChats).values({ chatId, enabledAt: new Date().toISOString() }).run();
  }
  const chatMemberApi: ChatMemberApi = { getChatMember: async (chatId) => ({ status: opts.memberChats ? (opts.memberChats.includes(String(chatId)) ? 'member' : 'left') : opts.memberStatus }) };
  const authenticate = createAuthenticate({
    db,
    botToken: BOT_TOKEN,
    adminTelegramId: opts.adminTelegramId,
    chatMemberApi,
    dev: opts.dev,
  });
  const app = Fastify();
  app.get('/whoami', { preHandler: authenticate }, async (req) => req.authedUser);
  app.get('/admin-only', { preHandler: [authenticate, requireAdmin] }, async () => ({ ok: true }));
  return Object.assign(app, { db });
}

function whoami(app: ReturnType<typeof buildTestApp>, devUser: string) {
  return app.inject({ method: 'GET', url: '/whoami', headers: { 'x-dev-user': devUser } });
}

describe('authenticate middleware', () => {
  it('accepts membership in either allowed chat and denies access after the only matching chat is stopped', async () => {
    const app = buildTestApp({ memberStatus: 'left', adminTelegramId: '999', allowedChatIds: ['-1001', '-1002'], memberChats: ['-1002'] });
    const headers = { 'x-telegram-init-data': signedInitData(555) };
    expect((await app.inject({ method: 'GET', url: '/whoami', headers })).statusCode).toBe(200);
    await disallowChat(app.db, '-1002');
    expect((await app.inject({ method: 'GET', url: '/whoami', headers })).statusCode).toBe(403);
  });
  it('401s when the init-data header is missing', async () => {
    const app = buildTestApp({ memberStatus: 'member', adminTelegramId: '999' });
    const res = await app.inject({ method: 'GET', url: '/whoami' });
    expect(res.statusCode).toBe(401);
  });

  it('401s when the signature is tampered with', async () => {
    const app = buildTestApp({ memberStatus: 'member', adminTelegramId: '999' });
    // Get a valid initData
    let validData = signedInitData(555);
    // Tamper with the hash by flipping a byte
    const params = new URLSearchParams(validData);
    const hash = params.get('hash');
    if (hash) {
      const tamperedHash = hash.substring(0, 2) + (Number('0x' + hash.substring(2, 4)) ^ 1).toString(16).padStart(2, '0') + hash.substring(4);
      params.set('hash', tamperedHash);
      validData = params.toString();
    }
    const res = await app.inject({
      method: 'GET',
      url: '/whoami',
      headers: { 'x-telegram-init-data': validData },
    });
    expect(res.statusCode).toBe(401);
  });

  it('401s when auth_date is expired', async () => {
    const app = buildTestApp({ memberStatus: 'member', adminTelegramId: '999' });
    const params = new URLSearchParams();
    // Set auth_date to 2 days in the past
    params.set('auth_date', String(Math.floor(Date.now() / 1000) - 172800));
    params.set('user', JSON.stringify({ id: 555, first_name: 'Ann' }));
    const pairs = [...params.entries()].sort(([a], [b]) => a.localeCompare(b));
    const dataCheckString = pairs.map(([k, v]) => `${k}=${v}`).join('\n');
    const secretKey = crypto.createHmac('sha256', 'WebAppData').update(BOT_TOKEN).digest();
    const hash = crypto.createHmac('sha256', secretKey).update(dataCheckString).digest('hex');
    params.set('hash', hash);
    const res = await app.inject({
      method: 'GET',
      url: '/whoami',
      headers: { 'x-telegram-init-data': params.toString() },
    });
    expect(res.statusCode).toBe(401);
  });

  it('403s when the user is not a group member', async () => {
    const app = buildTestApp({ memberStatus: 'left', adminTelegramId: '999' });
    const res = await app.inject({
      method: 'GET',
      url: '/whoami',
      headers: { 'x-telegram-init-data': signedInitData(555) },
    });
    expect(res.statusCode).toBe(403);
  });

  it('creates the user on first sight and assigns admin role by telegram id', async () => {
    const app = buildTestApp({ memberStatus: 'member', adminTelegramId: '555' });
    const res = await app.inject({
      method: 'GET',
      url: '/whoami',
      headers: { 'x-telegram-init-data': signedInitData(555) },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ telegramId: '555', role: 'admin', displayName: 'Ann' });
  });

  it('ignores X-Dev-User unless the server runs in dev mode', async () => {
    const app = buildTestApp({ memberStatus: 'member', adminTelegramId: '999' });
    const res = await whoami(app, 'Ann');
    expect(res.statusCode).toBe(401);
  });

  it('requireAdmin blocks a member-role user', async () => {
    const app = buildTestApp({ memberStatus: 'member', adminTelegramId: '999' });
    const res = await app.inject({
      method: 'GET',
      url: '/admin-only',
      headers: { 'x-telegram-init-data': signedInitData(555) },
    });
    expect(res.statusCode).toBe(403);
  });
});

describe('authenticate middleware in dev mode', () => {
  it('takes the identity from X-Dev-User, no signature needed', async () => {
    const app = buildTestApp({ memberStatus: 'left', adminTelegramId: '999', dev: { adminName: '' } });
    const res = await whoami(app, 'Ann');
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ telegramId: 'dev:Ann', displayName: 'Ann' });
  });

  it('401s without the header — dev mode still needs to know who you are', async () => {
    const app = buildTestApp({ memberStatus: 'member', adminTelegramId: '999', dev: { adminName: '' } });
    const res = await app.inject({ method: 'GET', url: '/whoami' });
    expect(res.statusCode).toBe(401);
  });

  it('gives admin to the configured name and member to everyone else', async () => {
    const app = buildTestApp({
      memberStatus: 'member',
      adminTelegramId: '999',
      dev: { adminName: 'Ann' },
    });
    expect((await whoami(app, 'Ann')).json()).toMatchObject({ role: 'admin' });
    expect((await whoami(app, 'Bob')).json()).toMatchObject({ role: 'member' });
  });

  it('without a configured name, the first one in is the admin', async () => {
    const app = buildTestApp({ memberStatus: 'member', adminTelegramId: '999', dev: { adminName: '' } });
    expect((await whoami(app, 'Bob')).json()).toMatchObject({ role: 'admin' });
    expect((await whoami(app, 'Ann')).json()).toMatchObject({ role: 'member' });
    // Sticky: coming back does not re-decide the role.
    expect((await whoami(app, 'Bob')).json()).toMatchObject({ role: 'admin' });
  });
});
