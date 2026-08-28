import { eq, and } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { roundPayments } from '../db/schema.js';

export async function setPaymentStatus(
  db: Db,
  roundId: number,
  userId: number,
  paid: boolean,
  markedByUserId: number
) {
  const existing = await db
    .select()
    .from(roundPayments)
    .where(and(eq(roundPayments.roundId, roundId), eq(roundPayments.userId, userId)))
    .get();
  const now = new Date().toISOString();
  if (existing) {
    await db
      .update(roundPayments)
      .set({ paid, markedAt: now, markedByUserId })
      .where(eq(roundPayments.id, existing.id))
      .run();
  } else {
    await db.insert(roundPayments).values({ roundId, userId, paid, markedAt: now, markedByUserId }).run();
  }
  return { roundId, userId, paid };
}

export async function getPaymentStatus(db: Db, roundId: number, userId: number) {
  const row = await db
    .select()
    .from(roundPayments)
    .where(and(eq(roundPayments.roundId, roundId), eq(roundPayments.userId, userId)))
    .get();
  return row?.paid ?? false;
}
