import { eq } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { orderItems } from '../db/schema.js';
import { listChecklist } from './checklist.js';
import { listOrderItems, type OrderItemRow } from './orderItems.js';

/**
 * Turning "the vendor brought 1 instead of 2" into "who exactly is short a pack"
 * (spec §7.1).
 *
 * The checklist counts packs per brand/flavour/weight, but people pay per line,
 * so somebody has to decide whose line loses the missing pack. That decision is
 * the admin's: this module only proposes a split and refuses to finish an order
 * while the numbers do not add up.
 */

export type DiscrepancyParticipant = {
  orderItemId: number;
  userId: number;
  quantity: number;
  /** What they ordered — a starting point, not a verdict. See `proposeSplit`. */
  proposedDeliveredQty: number;
};

export type DiscrepancyGroup = {
  brandId: number;
  flavorId: number;
  weightId: number;
  expectedQty: number;
  receivedQty: number;
  participants: DiscrepancyParticipant[];
};

function groupKey(item: { brandId: number; flavorId: number; weightId: number }) {
  return `${item.brandId}:${item.flavorId}:${item.weightId}`;
}

/**
 * Everyone starts with exactly what they ordered, so the admin only marks the
 * difference. A proportional pre-fill looked fairer but was worse to work with:
 * rounding left everybody short of their own order and the whole position had to
 * be redistributed by hand. Now the sum is off by exactly the shortfall (or the
 * surplus), and that is what the admin takes away — or hands out.
 */
function proposeSplit(items: OrderItemRow[]) {
  return items.map((item) => ({
    orderItemId: item.id,
    userId: item.userId,
    quantity: item.quantity,
    proposedDeliveredQty: item.quantity,
  }));
}

/** The positions where the delivery did not match the order — nothing else needs a decision. */
export async function listDiscrepancies(db: Db, orderId: number): Promise<DiscrepancyGroup[]> {
  const [checklist, items] = await Promise.all([listChecklist(db, orderId), listOrderItems(db, orderId)]);

  const groups: DiscrepancyGroup[] = [];
  for (const entry of checklist) {
    if (entry.receivedQty === entry.expectedQty) continue;
    const groupItems = items.filter((item) => groupKey(item) === groupKey(entry));
    groups.push({
      brandId: entry.brandId,
      flavorId: entry.flavorId,
      weightId: entry.weightId,
      expectedQty: entry.expectedQty,
      receivedQty: entry.receivedQty,
      participants: proposeSplit(groupItems),
    });
  }
  return groups;
}

export type Allocation = { orderItemId: number; deliveredQty: number };

/**
 * Freezes what each participant actually got. Lines that matched the delivery are
 * settled automatically; the ones that did not must be covered by `allocations`,
 * and each such group has to add up to exactly what arrived — otherwise somebody
 * would be charged for a pack nobody received, or get one for free.
 */
export async function applyDelivery(db: Db, orderId: number, allocations: Allocation[]) {
  const [checklist, items] = await Promise.all([listChecklist(db, orderId), listOrderItems(db, orderId)]);
  const byId = new Map(items.map((item) => [item.id, item]));

  for (const allocation of allocations) {
    if (!byId.has(allocation.orderItemId)) {
      throw new Error(`order item ${allocation.orderItemId} does not belong to this order`);
    }
    if (!Number.isInteger(allocation.deliveredQty) || allocation.deliveredQty < 0) {
      throw new Error('delivered quantity must be a non-negative whole number');
    }
  }

  const allocated = new Map(allocations.map((a) => [a.orderItemId, a.deliveredQty]));
  const mismatched = checklist.filter((entry) => entry.receivedQty !== entry.expectedQty);

  for (const entry of mismatched) {
    const groupItems = items.filter((item) => groupKey(item) === groupKey(entry));
    const missing = groupItems.filter((item) => !allocated.has(item.id));
    if (missing.length > 0) {
      throw new Error('every position with a discrepancy must be distributed between participants');
    }
    const total = groupItems.reduce((sum, item) => sum + (allocated.get(item.id) ?? 0), 0);
    if (total !== entry.receivedQty) {
      throw new Error(
        `distributed ${total} of ${entry.receivedQty} delivered packs — the numbers must match`
      );
    }
  }

  const mismatchedKeys = new Set(mismatched.map(groupKey));
  for (const item of items) {
    const deliveredQty = mismatchedKeys.has(groupKey(item))
      ? (allocated.get(item.id) ?? 0)
      : item.quantity;
    await db.update(orderItems).set({ deliveredQty }).where(eq(orderItems.id, item.id)).run();
  }
}

/** Undoes the freeze, so a reopened order can be collected and checked again. */
export async function clearDelivery(db: Db, orderId: number) {
  await db.update(orderItems).set({ deliveredQty: null }).where(eq(orderItems.orderId, orderId)).run();
}
