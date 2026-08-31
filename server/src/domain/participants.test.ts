import { describe, it, expect } from 'vitest';
import { createTestDb } from '../db/client';
import { createVendor, setVendorBrandPrice } from './vendors';
import { createBrand, getWeights } from './catalog';
import { replaceAvailability } from './availability';
import { createOrder } from './orders';
import { upsertOrderItem } from './orderItems';
import {
  clearAllReadiness,
  getPaymentStatus,
  getReadiness,
  setPaymentStatus,
  setReadiness,
} from './participants';
import { users } from '../db/schema';

async function setup() {
  const db = createTestDb();
  const [admin] = await db
    .insert(users)
    .values({ telegramId: 'a1', displayName: 'Admin', role: 'admin', firstSeenAt: new Date().toISOString() })
    .returning()
    .all();
  const [friend] = await db
    .insert(users)
    .values({ telegramId: 'f1', displayName: 'Friend', role: 'member', firstSeenAt: new Date().toISOString() })
    .returning()
    .all();
  const vendor = await createVendor(db, 'Vasya');
  const brand = await createBrand(db, 'DarkSide');
  await setVendorBrandPrice(db, vendor.id, brand.id, 20);
  const w250 = (await getWeights(db)).find((w) => w.grams === 250)!;
  const [{ flavorId }] = await replaceAvailability(db, {
    vendorId: vendor.id,
    brandId: brand.id,
    weightId: w250.id,
    entries: [{ name: 'CyberKiwi', available: true }],
  });
  const order = await createOrder(db, vendor.id, admin.id);
  return { db, admin, friend, brand, w250, flavorId, order };
}

describe('order participants', () => {
  it('defaults to not ready and not paid', async () => {
    const { db, friend, order } = await setup();
    expect(await getReadiness(db, order.id, friend.id)).toBe(false);
    expect(await getPaymentStatus(db, order.id, friend.id)).toBe(false);
  });

  it('remembers the payment mark and who made it', async () => {
    const { db, admin, friend, order } = await setup();
    await setPaymentStatus(db, order.id, friend.id, true, admin.id);
    expect(await getPaymentStatus(db, order.id, friend.id)).toBe(true);

    await setPaymentStatus(db, order.id, friend.id, false, admin.id);
    expect(await getPaymentStatus(db, order.id, friend.id)).toBe(false);
  });

  it('keeps readiness and payment independent of each other', async () => {
    const { db, admin, friend, order } = await setup();
    await setReadiness(db, order.id, friend.id, true);
    await setPaymentStatus(db, order.id, friend.id, true, admin.id);

    await setReadiness(db, order.id, friend.id, false);

    expect(await getPaymentStatus(db, order.id, friend.id)).toBe(true);
  });

  it('drops readiness as soon as the participant changes their lines', async () => {
    const { db, friend, order, brand, w250, flavorId } = await setup();
    await setReadiness(db, order.id, friend.id, true);

    await upsertOrderItem(db, {
      orderId: order.id,
      userId: friend.id,
      brandId: brand.id,
      flavorId,
      weightId: w250.id,
      quantity: 1,
    });

    expect(await getReadiness(db, order.id, friend.id)).toBe(false);
  });

  it('clears everyone at once when the order returns to collecting', async () => {
    const { db, admin, friend, order } = await setup();
    await setReadiness(db, order.id, friend.id, true);
    await setReadiness(db, order.id, admin.id, true);

    await clearAllReadiness(db, order.id);

    expect(await getReadiness(db, order.id, friend.id)).toBe(false);
    expect(await getReadiness(db, order.id, admin.id)).toBe(false);
  });
});
