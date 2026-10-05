import { eq, and } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { orderItems, orderParticipants } from '../db/schema.js';

export type ParticipantRow = typeof orderParticipants.$inferSelect;

async function getRow(db: Db, orderId: number, userId: number) {
  return db
    .select()
    .from(orderParticipants)
    .where(and(eq(orderParticipants.orderId, orderId), eq(orderParticipants.userId, userId)))
    .get();
}

async function ensureRow(db: Db, orderId: number, userId: number): Promise<ParticipantRow> {
  const existing = await getRow(db, orderId, userId);
  if (existing) return existing;
  const [row] = await db.insert(orderParticipants).values({ orderId, userId }).returning().all();
  return row;
}

export async function setPaymentStatus(
  db: Db,
  orderId: number,
  userId: number,
  paid: boolean,
  markedByUserId: number
) {
  const row = await ensureRow(db, orderId, userId);
  await db
    .update(orderParticipants)
    .set({ paid, paidMarkedAt: new Date().toISOString(), paidMarkedByUserId: markedByUserId })
    .where(eq(orderParticipants.id, row.id))
    .run();
  return { orderId, userId, paid };
}

export async function getPaymentStatus(db: Db, orderId: number, userId: number) {
  return (await getRow(db, orderId, userId))?.paid ?? false;
}

/**
 * "I'm done picking" (spec §5). It is a hint for the admin, not a lock: the
 * participant can still edit, and doing so clears the mark again.
 */
export async function setReadiness(db: Db, orderId: number, userId: number, ready: boolean) {
  const row = await ensureRow(db, orderId, userId);
  await db
    .update(orderParticipants)
    .set({ ready, readyAt: ready ? new Date().toISOString() : null })
    .where(eq(orderParticipants.id, row.id))
    .run();
  return { orderId, userId, ready };
}

/**
 * Who has said they are done, out of everyone who put something in the order.
 * A participant with no lines is not counted: they have nothing to be ready with.
 */
export async function readinessProgress(db: Db, orderId: number) {
  const ordering = new Set(
    (await db.select({ userId: orderItems.userId }).from(orderItems).where(eq(orderItems.orderId, orderId)).all()).map(
      (row) => row.userId
    )
  );
  const rows = await db.select().from(orderParticipants).where(eq(orderParticipants.orderId, orderId)).all();
  const readyCount = rows.filter((row) => row.ready && ordering.has(row.userId)).length;
  return { readyCount, totalParticipants: ordering.size };
}

export async function getReadiness(db: Db, orderId: number, userId: number) {
  return (await getRow(db, orderId, userId))?.ready ?? false;
}

/** Silently drops one participant's readiness — used when their lines change. */
export async function clearReadiness(db: Db, orderId: number, userId: number) {
  const row = await getRow(db, orderId, userId);
  if (!row || !row.ready) return;
  await db
    .update(orderParticipants)
    .set({ ready: false, readyAt: null })
    .where(eq(orderParticipants.id, row.id))
    .run();
}

/** Everyone's readiness goes when the order returns to collecting (spec §5). */
export async function clearAllReadiness(db: Db, orderId: number) {
  await db
    .update(orderParticipants)
    .set({ ready: false, readyAt: null })
    .where(eq(orderParticipants.orderId, orderId))
    .run();
}
