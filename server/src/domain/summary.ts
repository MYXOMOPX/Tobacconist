import type { Db } from '../db/client.js';
import { brands, flavors, weights } from '../db/schema.js';
import { listUserOrderItems, listOrderItems } from './orderItems.js';
import { getOrder, getOrderPriceSnapshot } from './orders.js';
import { isAvailable } from './availability.js';
import { packPriceEur } from './catalog.js';

export type AggregateLine = {
  brandId: number;
  brandName: string;
  flavorId: number;
  flavorName: string;
  weightId: number;
  grams: number;
  quantity: number;
  /** What actually arrived for this line, once the delivery was checked (§7.1); null before that. */
  deliveredQty: number | null;
  totalEur: number;
  /** False when the (flavor, weight) pair is no longer stocked by the order's vendor. */
  available: boolean;
};

async function nameLookups(db: Db) {
  const [brandRows, flavorRows, weightRows] = await Promise.all([
    db.select().from(brands).all(),
    db.select().from(flavors).all(),
    db.select().from(weights).all(),
  ]);
  return {
    brandName: (id: number) => brandRows.find((b) => b.id === id)!.name,
    flavorName: (id: number) => flavorRows.find((f) => f.id === id)!.name,
    grams: (id: number) => weightRows.find((w) => w.id === id)!.grams,
  };
}

/** What a line is charged for: the delivered count once known, the ordered count until then (spec §8). */
function billableQty(item: { quantity: number; deliveredQty: number | null }): number {
  return item.deliveredQty ?? item.quantity;
}

async function buildLines(
  db: Db,
  orderId: number,
  vendorId: number,
  items: { brandId: number; flavorId: number; weightId: number; quantity: number; deliveredQty: number | null }[]
): Promise<AggregateLine[]> {
  const lookup = await nameLookups(db);
  const lines: AggregateLine[] = [];
  for (const item of items) {
    const pricePerKg = await getOrderPriceSnapshot(db, orderId, item.brandId);
    if (pricePerKg === null || pricePerKg === undefined) {
      throw new Error(`missing price snapshot for brandId ${item.brandId} in order ${orderId}`);
    }
    const grams = lookup.grams(item.weightId);
    const unitPrice = packPriceEur(pricePerKg, grams);
    lines.push({
      brandId: item.brandId,
      brandName: lookup.brandName(item.brandId),
      flavorId: item.flavorId,
      flavorName: lookup.flavorName(item.flavorId),
      weightId: item.weightId,
      grams,
      quantity: item.quantity,
      deliveredQty: item.deliveredQty,
      totalEur: Math.round(unitPrice * billableQty(item) * 100) / 100,
      available: await isAvailable(db, vendorId, item.flavorId, item.weightId),
    });
  }
  return lines;
}

function totals(lines: AggregateLine[]) {
  const totalEur = Math.round(lines.reduce((s, l) => s + l.totalEur, 0) * 100) / 100;
  const totalKg = lines.reduce((s, l) => s + (l.grams * billableQty(l)) / 1000, 0);
  return { totalEur, totalKg };
}

export async function computeUserSummary(db: Db, orderId: number, userId: number) {
  const order = await getOrder(db, orderId);
  if (!order) throw new Error('order not found');
  const items = await listUserOrderItems(db, orderId, userId);
  const lines = await buildLines(db, orderId, order.vendorId, items);
  const hasUnavailableItems = lines.some((l) => !l.available);
  return { items: lines, ...totals(lines), hasUnavailableItems };
}

export async function computeAggregateSummary(db: Db, orderId: number) {
  const order = await getOrder(db, orderId);
  if (!order) throw new Error('order not found');
  const items = await listOrderItems(db, orderId);
  const grouped = new Map<
    string,
    { brandId: number; flavorId: number; weightId: number; quantity: number; deliveredQty: number | null }
  >();
  for (const item of items) {
    const key = `${item.brandId}:${item.flavorId}:${item.weightId}`;
    const existing = grouped.get(key);
    if (existing) {
      existing.quantity += item.quantity;
      // Delivered counts only add up once every line of the group has one.
      existing.deliveredQty =
        existing.deliveredQty === null || item.deliveredQty === null
          ? null
          : existing.deliveredQty + item.deliveredQty;
    } else {
      grouped.set(key, {
        brandId: item.brandId,
        flavorId: item.flavorId,
        weightId: item.weightId,
        quantity: item.quantity,
        deliveredQty: item.deliveredQty,
      });
    }
  }
  const lines = await buildLines(db, orderId, order.vendorId, [...grouped.values()]);
  return { lines, ...totals(lines) };
}
