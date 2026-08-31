import { eq, and } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { deliveryChecklistItems } from '../db/schema.js';
import { computeAggregateSummary } from './summary.js';

export type ChecklistRow = typeof deliveryChecklistItems.$inferSelect;

export async function generateOrUpdateChecklist(db: Db, orderId: number) {
  const { lines } = await computeAggregateSummary(db, orderId);
  const existing = await db
    .select()
    .from(deliveryChecklistItems)
    .where(eq(deliveryChecklistItems.orderId, orderId))
    .all();

  const seenIds = new Set<number>();

  for (const line of lines) {
    const match = existing.find(
      (e) => e.brandId === line.brandId && e.flavorId === line.flavorId && e.weightId === line.weightId
    );
    if (match) {
      seenIds.add(match.id);
      await db
        .update(deliveryChecklistItems)
        .set({ expectedQty: line.quantity })
        .where(eq(deliveryChecklistItems.id, match.id))
        .run();
    } else {
      await db
        .insert(deliveryChecklistItems)
        .values({
          orderId,
          brandId: line.brandId,
          flavorId: line.flavorId,
          weightId: line.weightId,
          expectedQty: line.quantity,
          receivedQty: 0,
        })
        .run();
    }
  }

  for (const row of existing) {
    if (!seenIds.has(row.id)) {
      await db
        .update(deliveryChecklistItems)
        .set({ expectedQty: 0 })
        .where(eq(deliveryChecklistItems.id, row.id))
        .run();
    }
  }
}

export async function listChecklist(db: Db, orderId: number) {
  return db.select().from(deliveryChecklistItems).where(eq(deliveryChecklistItems.orderId, orderId)).all();
}

export async function adjustReceivedQty(db: Db, checklistItemId: number, delta: number) {
  const row = await db
    .select()
    .from(deliveryChecklistItems)
    .where(eq(deliveryChecklistItems.id, checklistItemId))
    .get();
  if (!row) throw new Error('checklist item not found');
  const receivedQty = Math.max(0, row.receivedQty + delta);
  const [updated] = await db
    .update(deliveryChecklistItems)
    .set({ receivedQty })
    .where(eq(deliveryChecklistItems.id, checklistItemId))
    .returning()
    .all();
  return updated;
}
