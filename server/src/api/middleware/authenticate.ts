import type { FastifyRequest, FastifyReply } from 'fastify';
import { eq } from 'drizzle-orm';
import type { Db } from '../../db/client.js';
import { users } from '../../db/schema.js';
import { verifyInitData, checkGroupMembership, type ChatMemberApi } from '../../telegram/auth.js';
import { listAllowedChatIds } from '../../telegram/allowedChats.js';

export type AuthedUser = { id: number; telegramId: string; displayName: string; role: 'admin' | 'member' };

declare module 'fastify' {
  interface FastifyRequest {
    authedUser?: AuthedUser;
  }
}

/**
 * The dev-mode identity: whoever the `X-Dev-User` header says, no signature and
 * no group check. Sticky — a name keeps the role it got the first time it was
 * seen, so a reload does not silently promote or demote the person debugging.
 */
async function findOrCreateDevUser(db: Db, name: string, adminName: string) {
  const telegramId = `dev:${name}`;
  const existing = await db.select().from(users).where(eq(users.telegramId, telegramId)).get();
  if (existing) return existing;

  const role: 'admin' | 'member' = adminName
    ? name.toLowerCase() === adminName.toLowerCase()
      ? 'admin'
      : 'member'
    : // No name configured: the first person through the door is the admin, which
      // is the one debugging alone.
      (await db.select().from(users).all()).length === 0
      ? 'admin'
      : 'member';

  const [row] = await db
    .insert(users)
    .values({ telegramId, displayName: name, role, firstSeenAt: new Date().toISOString() })
    .returning()
    .all();
  return row;
}

export function createAuthenticate(deps: {
  db: Db;
  botToken: string;
  adminTelegramId: string;
  chatMemberApi: ChatMemberApi;
  /** Present only when the server runs without Telegram (config `devNoTelegram`). */
  dev?: { adminName: string };
}) {
  return async function authenticate(req: FastifyRequest, reply: FastifyReply) {
    if (deps.dev) {
      const name = req.headers['x-dev-user'];
      if (typeof name !== 'string' || name.trim() === '') {
        reply.code(401).send({ error: 'missing X-Dev-User header' });
        return;
      }
      const row = await findOrCreateDevUser(deps.db, name.trim(), deps.dev.adminName);
      req.authedUser = {
        id: row.id,
        telegramId: row.telegramId,
        displayName: row.displayName,
        role: row.role as 'admin' | 'member',
      };
      return;
    }

    const initData = req.headers['x-telegram-init-data'];
    if (typeof initData !== 'string') {
      reply.code(401).send({ error: 'missing X-Telegram-Init-Data header' });
      return;
    }

    const verified = verifyInitData({ initData, botToken: deps.botToken });
    if (!verified.ok) {
      reply.code(401).send({ error: verified.reason });
      return;
    }

    const allowedChatIds = await listAllowedChatIds(deps.db);
    let isMember = false;
    for (const chatId of allowedChatIds) {
      if (await checkGroupMembership(deps.chatMemberApi, chatId, Number(verified.telegramId))) {
        isMember = true;
        break;
      }
    }
    if (!isMember) {
      reply.code(403).send({ error: 'not a member of the group chat' });
      return;
    }

    const role: 'admin' | 'member' = verified.telegramId === deps.adminTelegramId ? 'admin' : 'member';
    const existing = await deps.db.select().from(users).where(eq(users.telegramId, verified.telegramId)).get();

    let row;
    if (existing) {
      if (existing.role !== role || existing.displayName !== verified.displayName) {
        [row] = await deps.db
          .update(users)
          .set({ role, displayName: verified.displayName })
          .where(eq(users.id, existing.id))
          .returning()
          .all();
      } else {
        row = existing;
      }
    } else {
      try {
        [row] = await deps.db
          .insert(users)
          .values({
            telegramId: verified.telegramId,
            displayName: verified.displayName,
            role,
            firstSeenAt: new Date().toISOString(),
          })
          .returning()
          .all();
      } catch (err) {
        // Handle race condition: another request may have inserted the same user concurrently
        // Re-select the now-existing row
        const reselect = await deps.db.select().from(users).where(eq(users.telegramId, verified.telegramId)).get();
        if (!reselect) {
          throw err; // Not a duplicate key error, re-throw
        }
        row = reselect;
      }
    }

    req.authedUser = { id: row.id, telegramId: row.telegramId, displayName: row.displayName, role: row.role as 'admin' | 'member' };
  };
}

export function requireAdmin(req: FastifyRequest, reply: FastifyReply, done: (err?: Error) => void) {
  if (req.authedUser?.role !== 'admin') {
    reply.code(403).send({ error: 'admin only' });
    return;
  }
  done();
}
