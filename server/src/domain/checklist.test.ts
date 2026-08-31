import { describe, it, expect } from 'vitest';
import { createTestDb } from '../db/client';
import { createVendor, setVendorBrandPrice } from './vendors';
import { createBrand, getWeights } from './catalog';
import { replaceAvailability } from './availability';
import { createOrder } from './orders';
import { upsertOrderItem } from './orderItems';
import { users } from '../db/schema';
import { generateOrUpdateChecklist, listChecklist, adjustReceivedQty } from './checklist';

async function setup() {
  const db = createTestDb();
  const [admin] = await db.insert(users).values({ telegramId: 'a1', displayName: 'Admin', role: 'admin', firstSeenAt: new Date().toISOString() }).returning().all();
  const vendor = await createVendor(db, 'Vasya');
  const brand = await createBrand(db, 'DarkSide');
  await setVendorBrandPrice(db, vendor.id, brand.id, 20);
  const w250 = (await getWeights(db)).find((w) => w.grams === 250)!;
  const [{ flavorId }] = await replaceAvailability(db, { vendorId: vendor.id, brandId: brand.id, weightId: w250.id, entries: [{ name: 'CyberKiwi', available: true }] });
  const order = await createOrder(db, vendor.id, admin.id);
  await upsertOrderItem(db, { orderId: order.id, userId: admin.id, brandId: brand.id, flavorId, weightId: w250.id, quantity: 5 });
  return { db, admin, vendor, brand, w250, flavorId, order };
}

describe('checklist domain', () => {
  it('generates one checklist row per aggregate line with expectedQty set', async () => {
    const { db, order } = await setup();
    await generateOrUpdateChecklist(db, order.id);
    const items = await listChecklist(db, order.id);
    expect(items).toHaveLength(1);
    expect(items[0].expectedQty).toBe(5);
    expect(items[0].receivedQty).toBe(0);
  });

  it('adjustReceivedQty increments and decrements, clamped at 0', async () => {
    const { db, order } = await setup();
    await generateOrUpdateChecklist(db, order.id);
    const [item] = await listChecklist(db, order.id);
    const bumped = await adjustReceivedQty(db, item.id, 1);
    expect(bumped.receivedQty).toBe(1);
    const dropped = await adjustReceivedQty(db, item.id, -5);
    expect(dropped.receivedQty).toBe(0);
  });

  it('regenerating preserves receivedQty for a still-matching line while updating expectedQty', async () => {
    const { db, admin, brand, w250, flavorId, order } = await setup();
    await generateOrUpdateChecklist(db, order.id);
    const [item] = await listChecklist(db, order.id);
    await adjustReceivedQty(db, item.id, 3);

    await upsertOrderItem(db, { orderId: order.id, userId: admin.id, brandId: brand.id, flavorId, weightId: w250.id, quantity: 8 });
    await generateOrUpdateChecklist(db, order.id);

    const [updated] = await listChecklist(db, order.id);
    expect(updated.expectedQty).toBe(8);
    expect(updated.receivedQty).toBe(3);
  });

  it('a line removed from the order sets expectedQty to 0 but keeps receivedQty', async () => {
    const { db, admin, brand, w250, flavorId, order } = await setup();
    await generateOrUpdateChecklist(db, order.id);
    const [item] = await listChecklist(db, order.id);
    await adjustReceivedQty(db, item.id, 2);

    await upsertOrderItem(db, { orderId: order.id, userId: admin.id, brandId: brand.id, flavorId, weightId: w250.id, quantity: 0 });
    await generateOrUpdateChecklist(db, order.id);

    const [updated] = await listChecklist(db, order.id);
    expect(updated.expectedQty).toBe(0);
    expect(updated.receivedQty).toBe(2);
  });
});
