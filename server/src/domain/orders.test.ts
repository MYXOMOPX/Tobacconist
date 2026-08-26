import { describe, it, expect } from 'vitest';
import { createTestDb } from '../db/client';
import { createVendor, setVendorBrandPrice } from './vendors';
import { createBrand, getWeights } from './catalog';
import { replaceAvailability } from './availability';
import { openRound, closeRound } from './rounds';
import { users } from '../db/schema';
import { upsertOrderItem, listUserOrderItems, listRoundOrderItems } from './orders';

async function setup() {
  const db = createTestDb();
  const [admin] = await db
    .insert(users)
    .values({ telegramId: 'a1', displayName: 'Admin', role: 'admin', firstSeenAt: new Date().toISOString() })
    .returning()
    .all();
  const [member] = await db
    .insert(users)
    .values({ telegramId: 'm1', displayName: 'Friend', role: 'member', firstSeenAt: new Date().toISOString() })
    .returning()
    .all();
  const vendor = await createVendor(db, 'Vasya');
  const brand = await createBrand(db, 'DarkSide');
  await setVendorBrandPrice(db, vendor.id, brand.id, 18);
  const w250 = (await getWeights(db)).find((w) => w.grams === 250)!;
  const [{ flavorId }] = await replaceAvailability(db, {
    vendorId: vendor.id,
    brandId: brand.id,
    weightId: w250.id,
    entries: [{ name: 'CyberKiwi', available: true }],
  });
  const round = await openRound(db, vendor.id, admin.id);
  return { db, admin, member, vendor, brand, w250, flavorId, round };
}

describe('orders domain', () => {
  it('creates an order item for an available flavor in an open round', async () => {
    const { db, member, brand, w250, flavorId, round } = await setup();
    const item = await upsertOrderItem(db, {
      roundId: round.id,
      userId: member.id,
      brandId: brand.id,
      flavorId,
      weightId: w250.id,
      quantity: 2,
    });
    expect(item?.quantity).toBe(2);
  });

  it('rejects orders for an unavailable (flavor, weight) pair', async () => {
    const { db, member, brand, w250, flavorId, round } = await setup();
    const w100 = (await getWeights(db)).find((w) => w.grams === 100)!;
    await expect(
      upsertOrderItem(db, {
        roundId: round.id,
        userId: member.id,
        brandId: brand.id,
        flavorId,
        weightId: w100.id,
        quantity: 1,
      })
    ).rejects.toThrow(/not available/i);
  });

  it('rejects orders against a closed round', async () => {
    const { db, member, brand, w250, flavorId, round } = await setup();
    await closeRound(db, round.id);
    await expect(
      upsertOrderItem(db, {
        roundId: round.id,
        userId: member.id,
        brandId: brand.id,
        flavorId,
        weightId: w250.id,
        quantity: 1,
      })
    ).rejects.toThrow(/not open/i);
  });

  it('repeat calls update quantity instead of duplicating rows', async () => {
    const { db, member, brand, w250, flavorId, round } = await setup();
    await upsertOrderItem(db, { roundId: round.id, userId: member.id, brandId: brand.id, flavorId, weightId: w250.id, quantity: 2 });
    await upsertOrderItem(db, { roundId: round.id, userId: member.id, brandId: brand.id, flavorId, weightId: w250.id, quantity: 5 });
    const items = await listUserOrderItems(db, round.id, member.id);
    expect(items).toHaveLength(1);
    expect(items[0].quantity).toBe(5);
  });

  it('quantity 0 deletes the row', async () => {
    const { db, member, brand, w250, flavorId, round } = await setup();
    await upsertOrderItem(db, { roundId: round.id, userId: member.id, brandId: brand.id, flavorId, weightId: w250.id, quantity: 2 });
    const result = await upsertOrderItem(db, { roundId: round.id, userId: member.id, brandId: brand.id, flavorId, weightId: w250.id, quantity: 0 });
    expect(result).toBeNull();
    expect(await listUserOrderItems(db, round.id, member.id)).toHaveLength(0);
  });

  it('listRoundOrderItems returns items across all users', async () => {
    const { db, admin, member, brand, w250, flavorId, round } = await setup();
    await upsertOrderItem(db, { roundId: round.id, userId: member.id, brandId: brand.id, flavorId, weightId: w250.id, quantity: 2 });
    await upsertOrderItem(db, { roundId: round.id, userId: admin.id, brandId: brand.id, flavorId, weightId: w250.id, quantity: 1 });
    const items = await listRoundOrderItems(db, round.id);
    expect(items).toHaveLength(2);
  });
});
