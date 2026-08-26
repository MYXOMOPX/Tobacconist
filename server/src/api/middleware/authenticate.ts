import type { FastifyRequest, FastifyReply } from 'fastify';
import { eq } from 'drizzle-orm';
import type { Db } from '../../db/client';
import { users } from '../../db/schema';
import { verifyInitData, checkGroupMembership, type ChatMemberApi } from '../../telegram/auth';

export type AuthedUser = { id: number; telegramId: string; displayName: string; role: 'admin' | 'member' };

declare module 'fastify' {
  interface FastifyRequest {
    authedUser?: AuthedUser;
  }
}

export function createAuthenticate(deps: {
  db: Db;
  botToken: string;
  groupChatId: string;
  adminTelegramId: string;
  chatMemberApi: ChatMemberApi;
}) {
  return async function authenticate(req: FastifyRequest, reply: FastifyReply) {
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

    const isMember = await checkGroupMembership(
      deps.chatMemberApi,
      deps.groupChatId,
      Number(verified.telegramId)
    );
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
