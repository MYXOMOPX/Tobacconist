import { eq, and } from 'drizzle-orm';
import type { Db } from '../db/client';
import { orderItems } from '../db/schema';
import { getRound, getRoundPriceSnapshot } from './rounds';
import { isAvailable } from './availability';

export type OrderItemRow = typeof orderItems.$inferSelect;

export async function upsertOrderItem(
  db: Db,
  params: {
    roundId: number;
    userId: number;
    brandId: number;
    flavorId: number;
    weightId: number;
    quantity: number;
  }
): Promise<OrderItemRow | null> {
  const { roundId, userId, brandId, flavorId, weightId, quantity } = params;

  const round = await getRound(db, roundId);
  if (!round) throw new Error('round not found');
  if (round.status !== 'open') throw new Error('round is not open');

  const available = await isAvailable(db, round.vendorId, flavorId, weightId);
  if (!available) throw new Error('this flavor/weight is not available for the round vendor');

  // Without a price snapshot for this brand, summary/snapshot/close would throw for
  // the whole round (see summary.ts) — reject just this order attempt instead.
  if (quantity > 0) {
    const pricePerKg = await getRoundPriceSnapshot(db, roundId, brandId);
    if (pricePerKg === null) throw new Error('no price set for this brand yet');
  }

  const existing = await db
    .select()
    .from(orderItems)
    .where(
      and(
        eq(orderItems.roundId, roundId),
        eq(orderItems.userId, userId),
        eq(orderItems.brandId, brandId),
        eq(orderItems.flavorId, flavorId),
        eq(orderItems.weightId, weightId)
      )
    )
    .get();

  if (quantity <= 0) {
    if (existing) await db.delete(orderItems).where(eq(orderItems.id, existing.id)).run();
    return null;
  }

  const now = new Date().toISOString();
  if (existing) {
    const [row] = await db
      .update(orderItems)
      .set({ quantity, updatedAt: now })
      .where(eq(orderItems.id, existing.id))
      .returning()
      .all();
    return row;
  }

  const [row] = await db
    .insert(orderItems)
    .values({ roundId, userId, brandId, flavorId, weightId, quantity, createdAt: now, updatedAt: now })
    .returning()
    .all();
  return row;
}

export async function listUserOrderItems(db: Db, roundId: number, userId: number) {
  return db
    .select()
    .from(orderItems)
    .where(and(eq(orderItems.roundId, roundId), eq(orderItems.userId, userId)))
    .all();
}

export async function listRoundOrderItems(db: Db, roundId: number) {
  return db.select().from(orderItems).where(eq(orderItems.roundId, roundId)).all();
}
