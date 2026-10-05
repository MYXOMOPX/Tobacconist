import { describe, expect, it } from 'vitest';
import { createTestDb } from '../db/client';
import { flavors, orderItems, orders, users } from '../db/schema';
import { createVendor } from './vendors';
import { createBrand, getWeights } from './catalog';
import { listVendorAssortment } from './availability';
import { vendorFlavorAvailability } from '../db/schema';
import { findDuplicateClusters, mergeFlavors, proposeMerges } from './flavorMerge';
import { reviewDuplicates } from '../gemini/duplicateReview';
import type { GeminiClient } from '../gemini/client';

async function setup() {
  const db = createTestDb();
  const brand = await createBrand(db, 'DarkSide');
  const vendor = await createVendor(db, 'Vasya');
  const w250 = (await getWeights(db)).find((w) => w.grams === 250)!;
  const add = async (name: string) =>
    (await db.insert(flavors).values({ brandId: brand.id, name }).returning().all())[0];
  const stock = (flavorId: number, available: boolean) =>
    db
      .insert(vendorFlavorAvailability)
      .values({ vendorId: vendor.id, flavorId, weightId: w250.id, available, updatedAt: 'now' })
      .run();
  return { db, brand, vendor, w250, add, stock };
}

describe('duplicate clusters', () => {
  it('groups twins and typos, leaves different flavours alone', async () => {
    const { db, brand, add } = await setup();
    await add('FRUITY DUST');
    await add('Fruity Dust ');
    await add('FRUITALITY');
    await add('FRUITTALLLITY');
    await add('MINT');
    await add('MIST');
    const clusters = await findDuplicateClusters(db, brand.id, { wide: true });
    expect(clusters.map((c) => c.map((f) => f.name).sort()).sort()).toEqual([
      ['FRUITALITY', 'FRUITTALLLITY'],
      ['FRUITY DUST', 'Fruity Dust '],
    ]);
  });

  it('keeps the spelling that is in use', async () => {
    const { db, brand, add, stock } = await setup();
    await add('FRUITTALLLITY');
    const good = await add('FRUITALITY');
    await stock(good.id, true);
    const [group] = await proposeMerges(db, await findDuplicateClusters(db, brand.id, { wide: true }));
    expect(group.keep.name).toBe('FRUITALITY');
    expect(group.fuzzy).toBe(true);
  });
});

describe('mergeFlavors', () => {
  it('moves stock and orders onto the kept flavour and removes the other', async () => {
    const { db, brand, vendor, w250, add, stock } = await setup();
    const keep = await add('FRUITALITY');
    const drop = await add('FRUITTALLLITY');
    await stock(keep.id, false);
    await stock(drop.id, true);

    const now = new Date().toISOString();
    const [user] = await db
      .insert(users)
      .values({ telegramId: '2', displayName: 'Friend', role: 'member', firstSeenAt: now })
      .returning()
      .all();
    const [order] = await db
      .insert(orders)
      .values({ vendorId: vendor.id, status: 'ordering', createdAt: now, statusChangedAt: now, createdByUserId: user.id })
      .returning()
      .all();
    const line = (flavorId: number, quantity: number) =>
      db
        .insert(orderItems)
        .values({
          orderId: order.id, userId: user.id, brandId: brand.id, flavorId, weightId: w250.id,
          quantity, addedByUserId: user.id, createdAt: now, updatedAt: now,
        })
        .run();
    await line(keep.id, 1);
    await line(drop.id, 2);

    await mergeFlavors(db, brand.id, [{ keepId: keep.id, dropIds: [drop.id] }]);

    const assortment = await listVendorAssortment(db, vendor.id);
    expect(assortment.map((r) => [r.flavorName, r.available])).toEqual([['FRUITALITY', true]]);
    const items = await db.select().from(orderItems).all();
    expect(items.map((i) => [i.flavorId, i.quantity])).toEqual([[keep.id, 3]]);
    expect(await db.select().from(flavors).all()).toHaveLength(1);
  });

  it('refuses flavours of another brand', async () => {
    const { db, brand, add } = await setup();
    const other = await createBrand(db, 'Other');
    const a = await add('A FLAVOR');
    const [b] = await db.insert(flavors).values({ brandId: other.id, name: 'B FLAVOR' }).returning().all();
    await expect(mergeFlavors(db, brand.id, [{ keepId: a.id, dropIds: [b.id] }])).rejects.toThrow('belong');
  });
});

describe('reviewDuplicates', () => {
  const textClient = (answer: string | Error): GeminiClient => ({
    generateFromImage: async () => '',
    generateText: async () => {
      if (answer instanceof Error) throw answer;
      return answer;
    },
  });

  it('lets the model veto a fuzzy cluster', async () => {
    const { db, brand, add } = await setup();
    await add('FRUITALITY');
    await add('FRUITTALLLITY');
    const out = await reviewDuplicates(db, textClient('{"answers":[{"id":0,"canonical":null,"same":[]}]}'), brand);
    expect(out.groups).toEqual([]);
    expect(out.judgedByAi).toBe(true);
  });

  it('takes the model canonical spelling', async () => {
    const { db, brand, add } = await setup();
    await add('FRUITTALLLITY');
    await add('FRUITALITY');
    const out = await reviewDuplicates(
      db,
      textClient('{"answers":[{"id":0,"canonical":"fruitality","same":["Fruittalllity"]}]}'),
      brand
    );
    expect(out.groups[0].keep.name).toBe('FRUITALITY');
    expect(out.groups[0].duplicates.map((d) => d.name)).toEqual(['FRUITTALLLITY']);
  });

  it('falls back to the safe distance when the model fails', async () => {
    const { db, brand, add } = await setup();
    await add('FRUITALITY');
    await add('FRUITALITLY');
    await add('KASHMIR LEMON');
    await add('KASHMIR LIME');
    const out = await reviewDuplicates(db, textClient(new Error('503')), brand);
    expect(out.groups).toHaveLength(1);
    expect(out.groups[0].keep.name).toBe('FRUITALITY');
    expect(out.judgedByAi).toBe(false);
  });
});
