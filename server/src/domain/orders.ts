import { and, eq, inArray } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { orders, orderPriceSnapshots, vendorBrandPrices } from '../db/schema.js';

export type Order = typeof orders.$inferSelect;
export type OrderStatus = Order['status'];

/** Non-terminal statuses: the admin can still act on the order (spec §5). */
export const ACTIVE_STATUSES = ['ordering', 'awaiting_validation'] as const;

/**
 * The whole lifecycle in one place:
 *
 *   ordering ⇄ awaiting_validation → done
 *   ordering    → rejected
 *   awaiting_validation → rejected
 *
 * `done` and `rejected` are terminal — nothing leads out of them.
 */
const ALLOWED_TRANSITIONS: Record<OrderStatus, OrderStatus[]> = {
  ordering: ['awaiting_validation', 'rejected'],
  awaiting_validation: ['ordering', 'done', 'rejected'],
  done: [],
  rejected: [],
};

export function isActiveStatus(status: OrderStatus): boolean {
  return status === 'ordering' || status === 'awaiting_validation';
}

export function canTransition(from: OrderStatus, to: OrderStatus): boolean {
  return ALLOWED_TRANSITIONS[from].includes(to);
}

export async function getOrder(db: Db, orderId: number): Promise<Order | null> {
  const row = await db.select().from(orders).where(eq(orders.id, orderId)).get();
  return row ?? null;
}

export async function listActiveOrders(db: Db): Promise<Order[]> {
  return db
    .select()
    .from(orders)
    .where(inArray(orders.status, [...ACTIVE_STATUSES]))
    .all();
}

export async function getActiveOrderForVendor(db: Db, vendorId: number): Promise<Order | null> {
  const row = await db
    .select()
    .from(orders)
    .where(and(eq(orders.vendorId, vendorId), inArray(orders.status, [...ACTIVE_STATUSES])))
    .get();
  return row ?? null;
}

export async function listFinishedOrders(db: Db): Promise<Order[]> {
  return db
    .select()
    .from(orders)
    .where(inArray(orders.status, ['done', 'rejected']))
    .all();
}

/**
 * Opens an order at a vendor and freezes that vendor's prices into it, so a later
 * price edit cannot change what people already owe (spec §3).
 */
export async function createOrder(db: Db, vendorId: number, createdByUserId: number): Promise<Order> {
  const existing = await getActiveOrderForVendor(db, vendorId);
  if (existing) throw new Error('this vendor already has an active order');

  const now = new Date().toISOString();
  const [order] = await db
    .insert(orders)
    .values({ vendorId, status: 'ordering', createdAt: now, statusChangedAt: now, createdByUserId })
    .returning()
    .all();

  const prices = await db
    .select()
    .from(vendorBrandPrices)
    .where(eq(vendorBrandPrices.vendorId, vendorId))
    .all();

  for (const price of prices) {
    await db
      .insert(orderPriceSnapshots)
      .values({ orderId: order.id, brandId: price.brandId, pricePerKgEur: price.pricePerKgEur })
      .run();
  }

  return order;
}

export async function setOrderStatus(db: Db, orderId: number, next: OrderStatus): Promise<Order> {
  const order = await getOrder(db, orderId);
  if (!order) throw new Error('order not found');
  if (order.status === next) throw new Error(`order is already ${next}`);
  if (!canTransition(order.status, next)) {
    throw new Error(`cannot move an order from ${order.status} to ${next}`);
  }

  const [updated] = await db
    .update(orders)
    .set({ status: next, statusChangedAt: new Date().toISOString() })
    .where(eq(orders.id, orderId))
    .returning()
    .all();
  return updated;
}

export async function getOrderPriceSnapshot(db: Db, orderId: number, brandId: number) {
  const rows = await db
    .select()
    .from(orderPriceSnapshots)
    .where(eq(orderPriceSnapshots.orderId, orderId))
    .all();
  return rows.find((row) => row.brandId === brandId)?.pricePerKgEur ?? null;
}
