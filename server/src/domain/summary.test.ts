import { describe, it, expect } from 'vitest';
import { createTestDb } from '../db/client';
import { createVendor, setVendorBrandPrice } from './vendors';
import { createBrand, getWeights } from './catalog';
import { replaceAvailability } from './availability';
import { openRound } from './rounds';
import { upsertOrderItem } from './orders';
import { users, orderItems } from '../db/schema';
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

  it('marks the specific line unavailable, leaving still-stocked lines available', async () => {
    const { db, vendor, brand, friend, w250, flavorId, round } = await setup();
    const w100 = (await getWeights(db)).find((w) => w.grams === 100)!;
    // A second, 100g line of the same brand that stays in stock throughout.
    const [{ flavorId: keptFlavorId }] = await replaceAvailability(db, {
      vendorId: vendor.id,
      brandId: brand.id,
      weightId: w100.id,
      entries: [{ name: 'Bananapapa', available: true }],
    });
    await upsertOrderItem(db, { roundId: round.id, userId: friend.id, brandId: brand.id, flavorId, weightId: w250.id, quantity: 2 });
    await upsertOrderItem(db, { roundId: round.id, userId: friend.id, brandId: brand.id, flavorId: keptFlavorId, weightId: w100.id, quantity: 1 });

    // Re-upload drops CyberKiwi (250g) only.
    await replaceAvailability(db, { vendorId: vendor.id, brandId: brand.id, weightId: w250.id, entries: [] });

    const summary = await computeUserSummary(db, round.id, friend.id);
    expect(summary.items).toHaveLength(2);
    const dropped = summary.items.find((l) => l.flavorId === flavorId)!;
    const kept = summary.items.find((l) => l.flavorId === keptFlavorId)!;
    expect(dropped.available).toBe(false);
    expect(kept.available).toBe(true);
    expect(summary.hasUnavailableItems).toBe(true);
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
    // upsertOrderItem now rejects unpriced brands (the preventive half of this bug),
    // so insert the row directly to keep this defense-in-depth check on summary.ts
    // itself: even if such a row exists (e.g. written before that guard, or by a
    // future code path), the summary must throw rather than silently charge 0 EUR.
    const now = new Date().toISOString();
    await db
      .insert(orderItems)
      .values({ roundId: round.id, userId: friend.id, brandId: unpricedBrand.id, flavorId: unpricedFlavorId, weightId: w250.id, quantity: 1, createdAt: now, updatedAt: now })
      .run();
    // Computing summary should throw because there's no price snapshot for the unpriced brand
    await expect(computeUserSummary(db, round.id, friend.id)).rejects.toThrow(`missing price snapshot for brandId ${unpricedBrand.id} in round ${round.id}`);
    await expect(computeAggregateSummary(db, round.id)).rejects.toThrow(`missing price snapshot for brandId ${unpricedBrand.id} in round ${round.id}`);
  });
});
