import { describe, it, expect } from 'vitest';
import { createTestDb } from '../db/client';
import { createVendor, setVendorBrandPrice } from './vendors';
import { createBrand, getWeights } from './catalog';
import { replaceAvailability } from './availability';
import { openRound } from './rounds';
import { upsertOrderItem } from './orders';
import { users } from '../db/schema';
import { computeUserSummary, computeAggregateSummary } from './summary';

async function setup() {
  const db = createTestDb();
  const [admin] = await db.insert(users).values({ telegramId: 'a1', displayName: 'Admin', role: 'admin', firstSeenAt: new Date().toISOString() }).returning().all();
  const [friend] = await db.insert(users).values({ telegramId: 'f1', displayName: 'Friend', role: 'member', firstSeenAt: new Date().toISOString() }).returning().all();
  const vendor = await createVendor(db, 'Vasya');
  const brand = await createBrand(db, 'DarkSide');
  await setVendorBrandPrice(db, vendor.id, brand.id, 20); // 20 EUR/kg
  const w250 = (await getWeights(db)).find((w) => w.grams === 250)!;
  const [{ flavorId }] = await replaceAvailability(db, {
    vendorId: vendor.id,
    brandId: brand.id,
    weightId: w250.id,
    entries: [{ name: 'CyberKiwi', available: true }],
  });
  const round = await openRound(db, vendor.id, admin.id);
  return { db, admin, friend, vendor, brand, w250, flavorId, round };
}

describe('summary domain', () => {
  it('computeUserSummary totals kg and eur at the pack price (20 EUR/kg * 250g = 5 EUR/pack)', async () => {
    const { db, friend, brand, w250, flavorId, round } = await setup();
    await upsertOrderItem(db, { roundId: round.id, userId: friend.id, brandId: brand.id, flavorId, weightId: w250.id, quantity: 3 });
    const summary = await computeUserSummary(db, round.id, friend.id);
    expect(summary.totalEur).toBeCloseTo(15.0);
    expect(summary.totalKg).toBeCloseTo(0.75);
    expect(summary.hasUnavailableItems).toBe(false);
  });

  it('flags hasUnavailableItems when a re-upload later removes the flavor', async () => {
    const { db, brand, vendor, friend, w250, flavorId, round } = await setup();
    await upsertOrderItem(db, { roundId: round.id, userId: friend.id, brandId: brand.id, flavorId, weightId: w250.id, quantity: 1 });
    await replaceAvailability(db, { vendorId: vendor.id, brandId: brand.id, weightId: w250.id, entries: [] });
    const summary = await computeUserSummary(db, round.id, friend.id);
    expect(summary.hasUnavailableItems).toBe(true);
    expect(summary.items).toHaveLength(1); // still present, just flagged
  });

  it('computeAggregateSummary sums quantities across users for the same line', async () => {
    const { db, admin, friend, brand, w250, flavorId, round } = await setup();
    await upsertOrderItem(db, { roundId: round.id, userId: friend.id, brandId: brand.id, flavorId, weightId: w250.id, quantity: 3 });
    await upsertOrderItem(db, { roundId: round.id, userId: admin.id, brandId: brand.id, flavorId, weightId: w250.id, quantity: 2 });
    const summary = await computeAggregateSummary(db, round.id);
    expect(summary.lines).toHaveLength(1);
    expect(summary.lines[0].quantity).toBe(5);
    expect(summary.totalEur).toBeCloseTo(25.0);
  });

  it('throws when computing summary for a brand without a price snapshot', async () => {
    const db = createTestDb();
    const [admin] = await db.insert(users).values({ telegramId: 'a1', displayName: 'Admin', role: 'admin', firstSeenAt: new Date().toISOString() }).returning().all();
    const [friend] = await db.insert(users).values({ telegramId: 'f1', displayName: 'Friend', role: 'member', firstSeenAt: new Date().toISOString() }).returning().all();
    const vendor = await createVendor(db, 'Vasya');
    const pricedBrand = await createBrand(db, 'DarkSide');
    const unpricedBrand = await createBrand(db, 'NoPrice');
    await setVendorBrandPrice(db, vendor.id, pricedBrand.id, 20); // only price the first brand
    const w250 = (await getWeights(db)).find((w) => w.grams === 250)!;
    const [{ flavorId: pricedFlavorId }] = await replaceAvailability(db, {
      vendorId: vendor.id,
      brandId: pricedBrand.id,
      weightId: w250.id,
      entries: [{ name: 'CyberKiwi', available: true }],
    });
    const [{ flavorId: unpricedFlavorId }] = await replaceAvailability(db, {
      vendorId: vendor.id,
      brandId: unpricedBrand.id,
      weightId: w250.id,
      entries: [{ name: 'Mystery', available: true }],
    });
    const round = await openRound(db, vendor.id, admin.id);
    // Order from the unpriced brand - should succeed
    await upsertOrderItem(db, { roundId: round.id, userId: friend.id, brandId: unpricedBrand.id, flavorId: unpricedFlavorId, weightId: w250.id, quantity: 1 });
    // Computing summary should throw because there's no price snapshot for the unpriced brand
    await expect(computeUserSummary(db, round.id, friend.id)).rejects.toThrow(`missing price snapshot for brandId ${unpricedBrand.id} in round ${round.id}`);
    await expect(computeAggregateSummary(db, round.id)).rejects.toThrow(`missing price snapshot for brandId ${unpricedBrand.id} in round ${round.id}`);
  });
});
