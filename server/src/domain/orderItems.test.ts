import { describe, it, expect } from 'vitest';
import { createTestDb } from '../db/client';
import { users } from '../db/schema';
import { createVendor, setVendorBrandPrice } from './vendors';
import { createBrand, getWeights } from './catalog';
import { replaceAvailability, setFlavorAvailability } from './availability';
import { createOrder } from './orders';
import { listUserOrderItems, upsertOrderItem } from './orderItems';

async function setup() {
  const db = createTestDb();
  const [buyer] = await db
    .insert(users)
    .values({ telegramId: '2', displayName: 'Friend', role: 'member', firstSeenAt: new Date().toISOString() })
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
  const order = await createOrder(db, vendor.id, buyer.id);

  const line = { orderId: order.id, userId: buyer.id, brandId: brand.id, flavorId, weightId: w250.id };
  const soldOut = () =>
    setFlavorAvailability(db, {
      vendorId: vendor.id,
      brandId: brand.id,
      weightId: w250.id,
      flavorId,
      available: false,
    });

  return { db, buyer, order, line, soldOut };
}

describe('upsertOrderItem and availability', () => {
  it('refuses a position the vendor does not stock', async () => {
    const { db, line, soldOut } = await setup();
    await soldOut();

    await expect(upsertOrderItem(db, { ...line, quantity: 1 })).rejects.toThrow('not available');
  });

  /**
   * Spec §12: a line already in an order survives its flavour going out of stock —
   * it is only flagged. The one thing left to do with it is take it away, so the
   * stock check must not stand in the way of that.
   */
  it('lets a line that went out of stock be removed', async () => {
    const { db, buyer, order, line, soldOut } = await setup();
    await upsertOrderItem(db, { ...line, quantity: 2 });
    await soldOut();

    await expect(upsertOrderItem(db, { ...line, quantity: 0 })).resolves.toBeNull();
    expect(await listUserOrderItems(db, order.id, buyer.id)).toEqual([]);
  });

  it('lets a line that went out of stock be cut down', async () => {
    const { db, buyer, order, line, soldOut } = await setup();
    await upsertOrderItem(db, { ...line, quantity: 3 });
    await soldOut();

    await upsertOrderItem(db, { ...line, quantity: 1 });
    const [row] = await listUserOrderItems(db, order.id, buyer.id);
    expect(row.quantity).toBe(1);
  });

  it('still refuses to grow a line that went out of stock', async () => {
    const { db, line, soldOut } = await setup();
    await upsertOrderItem(db, { ...line, quantity: 1 });
    await soldOut();

    await expect(upsertOrderItem(db, { ...line, quantity: 2 })).rejects.toThrow('not available');
  });
});
