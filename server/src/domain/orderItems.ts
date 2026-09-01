import { eq, and } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { orderItems } from '../db/schema.js';
import { getOrder, getOrderPriceSnapshot } from './orders.js';
import { isAvailable } from './availability.js';
import { clearReadiness } from './participants.js';

export type OrderItemRow = typeof orderItems.$inferSelect;

/**
 * Adds, changes or removes one line of an order.
 *
 * Who may do this depends on the status (spec §5): while collecting, everyone
 * edits their own lines; once the order is on validation only the admin may act,
 * and then on anyone's behalf — the line records who actually added it.
 */
export async function upsertOrderItem(
  db: Db,
  params: {
    orderId: number;
    userId: number;
    brandId: number;
    flavorId: number;
    weightId: number;
    quantity: number;
    /** Defaults to the participant: a line is their own unless the admin added it. */
    addedByUserId?: number;
    byAdmin?: boolean;
  }
): Promise<OrderItemRow | null> {
  const { orderId, userId, brandId, flavorId, weightId, quantity } = params;
  const addedByUserId = params.addedByUserId ?? userId;
  const byAdmin = params.byAdmin ?? false;

  const order = await getOrder(db, orderId);
  if (!order) throw new Error('order not found');

  if (order.status === 'ordering') {
    if (!byAdmin && userId !== addedByUserId) {
      throw new Error('you can only change your own lines');
    }
  } else if (order.status === 'awaiting_validation') {
    if (!byAdmin) throw new Error('the order is on validation, adding positions is closed');
  } else {
    throw new Error(`the order is ${order.status}, it can no longer be changed`);
  }

  const existing = await db
    .select()
    .from(orderItems)
    .where(
      and(
        eq(orderItems.orderId, orderId),
        eq(orderItems.userId, userId),
        eq(orderItems.brandId, brandId),
        eq(orderItems.flavorId, flavorId),
        eq(orderItems.weightId, weightId)
      )
    )
    .get();

  // Only asking for more needs the vendor to have it. A line already in the order
  // outlives its flavour going out of stock — spec §12 keeps it and just flags it —
  // and then the only thing left to do with it is shrink it or take it away, which
  // the stock check used to make impossible.
  if (quantity > (existing?.quantity ?? 0)) {
    const available = await isAvailable(db, order.vendorId, flavorId, weightId);
    if (!available) throw new Error('this flavor/weight is not available for the order vendor');
  }

  // Without a price snapshot for this brand, summary/snapshot/finish would throw for
  // the whole order (see summary.ts) — reject just this attempt instead.
  if (quantity > 0) {
    const pricePerKg = await getOrderPriceSnapshot(db, orderId, brandId);
    if (pricePerKg === null) throw new Error('no price set for this brand yet');
  }

  // Spec §5: changing what you ordered retracts your "I'm done picking" mark.
  await clearReadiness(db, orderId, userId);

  if (quantity <= 0) {
    if (existing) await db.delete(orderItems).where(eq(orderItems.id, existing.id)).run();
    return null;
  }

  const now = new Date().toISOString();
  if (existing) {
    const [row] = await db
      .update(orderItems)
      .set({ quantity, addedByUserId, updatedAt: now })
      .where(eq(orderItems.id, existing.id))
      .returning()
      .all();
    return row;
  }

  const [row] = await db
    .insert(orderItems)
    .values({
      orderId,
      userId,
      brandId,
      flavorId,
      weightId,
      quantity,
      addedByUserId,
      createdAt: now,
      updatedAt: now,
    })
    .returning()
    .all();
  return row;
}

export async function listUserOrderItems(db: Db, orderId: number, userId: number) {
  return db
    .select()
    .from(orderItems)
    .where(and(eq(orderItems.orderId, orderId), eq(orderItems.userId, userId)))
    .all();
}

export async function listOrderItems(db: Db, orderId: number) {
  return db.select().from(orderItems).where(eq(orderItems.orderId, orderId)).all();
}
