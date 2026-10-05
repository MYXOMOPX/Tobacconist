import { describe, it, expect } from 'vitest';
import { createTestDb } from '../db/client';
import { users, orders, orderItems } from '../db/schema';
import { createVendor } from './vendors';
import { createBrand, getWeights } from './catalog';
import { replaceAvailability, isAvailable, listVendorAssortment, applyAvailabilityBatch } from './availability';

async function setup() {
  const db = createTestDb();
  const vendor = await createVendor(db, 'Vasya');
  const brand = await createBrand(db, 'DarkSide');
  const w = await getWeights(db);
  const w250 = w.find((x) => x.grams === 250)!;
  const w100 = w.find((x) => x.grams === 100)!;
  return { db, vendor, brand, w250, w100 };
}

describe('availability domain', () => {
  it('replaceAvailability creates flavors and marks them available', async () => {
    const { db, vendor, brand, w250 } = await setup();
    const result = await replaceAvailability(db, {
      vendorId: vendor.id,
      brandId: brand.id,
      weightId: w250.id,
      entries: [
        { name: 'CyberKiwi', available: true },
        { name: 'Mango', available: false },
      ],
    });
    expect(result.find((r) => r.flavorName === 'CyberKiwi')?.available).toBe(true);
    expect(result.find((r) => r.flavorName === 'Mango')?.available).toBe(false);
  });

  it('a second upload for the same (brand, weight) fully replaces prior availability', async () => {
    const { db, vendor, brand, w250 } = await setup();
    await replaceAvailability(db, {
      vendorId: vendor.id,
      brandId: brand.id,
      weightId: w250.id,
      entries: [{ name: 'CyberKiwi', available: true }],
    });
    await replaceAvailability(db, {
      vendorId: vendor.id,
      brandId: brand.id,
      weightId: w250.id,
      entries: [{ name: 'Mango', available: true }],
    });
    const cyberKiwiFlavorId = (
      await listVendorAssortment(db, vendor.id)
    ).find((r) => r.flavorName === 'CyberKiwi')!.flavorId;
    expect(await isAvailable(db, vendor.id, cyberKiwiFlavorId, w250.id)).toBe(false);
  });

  it('availability is independent per weight', async () => {
    const { db, vendor, brand, w250, w100 } = await setup();
    await replaceAvailability(db, {
      vendorId: vendor.id,
      brandId: brand.id,
      weightId: w250.id,
      entries: [{ name: 'CyberKiwi', available: true }],
    });
    const assortment = await listVendorAssortment(db, vendor.id);
    const cyberKiwiFlavorId = assortment.find((r) => r.flavorName === 'CyberKiwi')!.flavorId;
    expect(await isAvailable(db, vendor.id, cyberKiwiFlavorId, w100.id)).toBe(false);
  });

  it('listVendorAssortment sorts by brand, then flavour, then weight', async () => {
    const { db, vendor, w250, w100 } = await setup();
    // Entered deliberately out of order, brands included.
    const musthave = await createBrand(db, 'MustHave');
    const adalya = await createBrand(db, 'Adalya');
    for (const [brandId, weightId, name] of [
      [musthave.id, w250.id, 'Пина Колада'],
      [musthave.id, w100.id, 'Пина Колада'],
      [musthave.id, w250.id, 'Ананас'],
      [adalya.id, w250.id, 'Love 66'],
    ] as const) {
      await replaceAvailability(db, {
        vendorId: vendor.id,
        brandId,
        weightId,
        entries: [{ name, available: true }],
      });
    }

    const rows = await listVendorAssortment(db, vendor.id);
    expect(rows.map((r) => `${r.brandName} / ${r.flavorName} / ${r.grams}`)).toEqual([
      'Adalya / Love 66 / 250',
      'MustHave / Ананас / 250',
      'MustHave / Пина Колада / 100',
      'MustHave / Пина Колада / 250',
    ]);
  });

  it('listVendorAssortment onlyAvailable filters out unavailable rows', async () => {
    const { db, vendor, brand, w250 } = await setup();
    await replaceAvailability(db, {
      vendorId: vendor.id,
      brandId: brand.id,
      weightId: w250.id,
      entries: [
        { name: 'CyberKiwi', available: true },
        { name: 'Mango', available: false },
      ],
    });
    const rows = await listVendorAssortment(db, vendor.id, { onlyAvailable: true });
    expect(rows.map((r) => r.flavorName)).toEqual(['CyberKiwi']);
  });

  it('duplicate flavor names in one upload create only one row', async () => {
    const { db, vendor, brand, w250 } = await setup();
    const result = await replaceAvailability(db, {
      vendorId: vendor.id,
      brandId: brand.id,
      weightId: w250.id,
      entries: [
        { name: 'CyberKiwi', available: true },
        { name: 'CyberKiwi', available: true },
      ],
    });
    const cyberKiwiEntries = result.filter((r) => r.flavorName === 'CyberKiwi');
    expect(cyberKiwiEntries).toHaveLength(1);
    const assortment = await listVendorAssortment(db, vendor.id);
    const cyberKiwiRows = assortment.filter((r) => r.flavorName === 'CyberKiwi');
    expect(cyberKiwiRows).toHaveLength(1);
  });

  it('cross-brand isolation: replacing brand X availability does not affect brand Y', async () => {
    const { db, vendor, w250 } = await setup();
    const brand1 = await createBrand(db, 'Brand1');
    const brand2 = await createBrand(db, 'Brand2');

    // Upload availability for brand1
    await replaceAvailability(db, {
      vendorId: vendor.id,
      brandId: brand1.id,
      weightId: w250.id,
      entries: [{ name: 'Flavor1', available: true }],
    });

    // Upload availability for brand2
    await replaceAvailability(db, {
      vendorId: vendor.id,
      brandId: brand2.id,
      weightId: w250.id,
      entries: [{ name: 'Flavor2', available: true }],
    });

    // Verify brand1's availability is unchanged
    const assortment = await listVendorAssortment(db, vendor.id);
    const brand1Rows = assortment.filter((r) => r.brandId === brand1.id);
    const brand2Rows = assortment.filter((r) => r.brandId === brand2.id);

    expect(brand1Rows).toHaveLength(1);
    expect(brand1Rows[0].flavorName).toBe('Flavor1');
    expect(brand1Rows[0].available).toBe(true);

    expect(brand2Rows).toHaveLength(1);
    expect(brand2Rows[0].flavorName).toBe('Flavor2');
    expect(brand2Rows[0].available).toBe(true);
  });
});

describe('applyAvailabilityBatch', () => {
  async function vendorWithTwoBrands() {
    const db = createTestDb();
    const vendor = await createVendor(db, 'Vasya');
    const dark = await createBrand(db, 'DarkSide');
    const must = await createBrand(db, 'MustHave');
    const w250 = (await getWeights(db)).find((w) => w.grams === 250)!;
    const w100 = (await getWeights(db)).find((w) => w.grams === 100)!;
    return { db, vendor, dark, must, w250, w100 };
  }

  it('saves several screenshots in one go', async () => {
    const { db, vendor, dark, must, w250 } = await vendorWithTwoBrands();

    await applyAvailabilityBatch(db, {
      vendorId: vendor.id,
      groups: [
        { brandId: dark.id, weightId: w250.id, entries: [{ name: 'Needls', available: true }] },
        { brandId: must.id, weightId: w250.id, entries: [{ name: 'Kiwi Smoothie', available: true }] },
      ],
    });

    const stock = await listVendorAssortment(db, vendor.id, { onlyAvailable: true });
    expect(stock.map((row) => row.flavorName).sort()).toEqual(['Kiwi Smoothie', 'Needls']);
  });

  it('leaves untouched brands alone by default', async () => {
    const { db, vendor, dark, must, w250 } = await vendorWithTwoBrands();
    await replaceAvailability(db, {
      vendorId: vendor.id,
      brandId: must.id,
      weightId: w250.id,
      entries: [{ name: 'Kiwi Smoothie', available: true }],
    });

    await applyAvailabilityBatch(db, {
      vendorId: vendor.id,
      groups: [{ brandId: dark.id, weightId: w250.id, entries: [{ name: 'Needls', available: true }] }],
    });

    const stock = await listVendorAssortment(db, vendor.id, { onlyAvailable: true });
    expect(stock.map((row) => row.flavorName).sort()).toEqual(['Kiwi Smoothie', 'Needls']);
  });

  it('wipeOthers drops everything the batch did not mention, across brands and weights', async () => {
    const { db, vendor, dark, must, w250, w100 } = await vendorWithTwoBrands();
    await replaceAvailability(db, {
      vendorId: vendor.id,
      brandId: must.id,
      weightId: w250.id,
      entries: [{ name: 'Kiwi Smoothie', available: true }],
    });
    await replaceAvailability(db, {
      vendorId: vendor.id,
      brandId: dark.id,
      weightId: w100.id,
      entries: [{ name: 'Ice Storm', available: true }],
    });

    await applyAvailabilityBatch(db, {
      vendorId: vendor.id,
      groups: [{ brandId: dark.id, weightId: w250.id, entries: [{ name: 'Needls', available: true }] }],
      wipeOthers: true,
    });

    const stock = await listVendorAssortment(db, vendor.id, { onlyAvailable: true });
    expect(stock.map((row) => row.flavorName)).toEqual(['Needls']);
  });

  it('makes screenshots of one brand agree on spellings, whatever the weight', async () => {
    const { db, vendor, dark, w250, w100 } = await vendorWithTwoBrands();
    await applyAvailabilityBatch(db, {
      vendorId: vendor.id,
      groups: [
        { brandId: dark.id, weightId: w250.id, entries: [{ name: 'Fruity Dust', available: true }] },
        { brandId: dark.id, weightId: w100.id, entries: [{ name: 'Fruity Dast', available: true }] },
      ],
    });
    const all = await listVendorAssortment(db, vendor.id);
    expect(all.map((row) => [row.flavorName, row.grams])).toEqual([
      ['Fruity Dust', 100],
      ['Fruity Dust', 250],
    ]);
  });

  it('wipeOthers erases rows nobody ordered, and keeps struck-through ones the batch listed', async () => {
    const { db, vendor, dark, must, w250 } = await vendorWithTwoBrands();
    await replaceAvailability(db, {
      vendorId: vendor.id,
      brandId: must.id,
      weightId: w250.id,
      entries: [{ name: 'Kiwi Smoothie', available: true }],
    });

    await applyAvailabilityBatch(db, {
      vendorId: vendor.id,
      groups: [
        {
          brandId: dark.id,
          weightId: w250.id,
          entries: [
            { name: 'Needls', available: true },
            { name: 'Sold Out', available: false },
          ],
        },
      ],
      wipeOthers: true,
    });

    const all = await listVendorAssortment(db, vendor.id);
    expect(all.map((row) => [row.flavorName, row.available]).sort()).toEqual([
      ['Needls', true],
      ['Sold Out', false],
    ]);
  });

  it('wipeOthers only flags a position an order of this vendor still refers to', async () => {
    const { db, vendor, dark, must, w250 } = await vendorWithTwoBrands();
    const [{ flavorId }] = await replaceAvailability(db, {
      vendorId: vendor.id,
      brandId: must.id,
      weightId: w250.id,
      entries: [{ name: 'Kiwi Smoothie', available: true }],
    });
    const now = new Date().toISOString();
    const [user] = await db
      .insert(users)
      .values({ telegramId: '2', displayName: 'Friend', role: 'member', firstSeenAt: now })
      .returning()
      .all();
    const [order] = await db
      .insert(orders)
      .values({
        vendorId: vendor.id,
        status: 'ordering',
        createdAt: now,
        statusChangedAt: now,
        createdByUserId: user.id,
      })
      .returning()
      .all();
    await db
      .insert(orderItems)
      .values({
        orderId: order.id,
        userId: user.id,
        brandId: must.id,
        flavorId,
        weightId: w250.id,
        quantity: 1,
        addedByUserId: user.id,
        createdAt: now,
        updatedAt: now,
      })
      .run();

    await applyAvailabilityBatch(db, {
      vendorId: vendor.id,
      groups: [{ brandId: dark.id, weightId: w250.id, entries: [{ name: 'Needls', available: true }] }],
      wipeOthers: true,
    });

    const all = await listVendorAssortment(db, vendor.id);
    expect(all.find((row) => row.flavorName === 'Kiwi Smoothie')).toMatchObject({ available: false });
  });

  it('does not touch another vendor stock', async () => {
    const { db, vendor, dark, w250 } = await vendorWithTwoBrands();
    const other = await createVendor(db, 'Petya');
    await replaceAvailability(db, {
      vendorId: other.id,
      brandId: dark.id,
      weightId: w250.id,
      entries: [{ name: 'Ice Storm', available: true }],
    });

    await applyAvailabilityBatch(db, {
      vendorId: vendor.id,
      groups: [{ brandId: dark.id, weightId: w250.id, entries: [{ name: 'Needls', available: true }] }],
      wipeOthers: true,
    });

    const otherStock = await listVendorAssortment(db, other.id, { onlyAvailable: true });
    expect(otherStock.map((row) => row.flavorName)).toEqual(['Ice Storm']);
  });
});
