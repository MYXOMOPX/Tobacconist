import type { Db } from '../db/client.js';
import { eq } from 'drizzle-orm';
import { allowedChats } from '../db/schema.js';

export async function allowChat(db: Db, chatId: string): Promise<void> {
  await db.insert(allowedChats).values({ chatId, enabledAt: new Date().toISOString() }).onConflictDoNothing().run();
}

export async function disallowChat(db: Db, chatId: string): Promise<void> {
  await db.delete(allowedChats).where(eq(allowedChats.chatId, chatId)).run();
}

export async function isChatAllowed(db: Db, chatId: string): Promise<boolean> {
  return !!(await db.select({ chatId: allowedChats.chatId }).from(allowedChats).where(eq(allowedChats.chatId, chatId)).get());
}

export async function listAllowedChatIds(db: Db): Promise<string[]> {
  const rows = await db.select({ chatId: allowedChats.chatId }).from(allowedChats).orderBy(allowedChats.chatId).all();
  return rows.map((row) => row.chatId);
}
