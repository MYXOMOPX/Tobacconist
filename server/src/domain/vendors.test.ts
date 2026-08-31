import { describe, it, expect } from 'vitest';
import { createTestDb } from '../db/client';
import { createBrand, getWeights } from './catalog';
import { replaceAvailability, listVendorAssortment } from './availability';
import { createOrder } from './orders';
import { users } from '../db/schema';

import { createVendor, listVendors, archiveVendor, setVendorBrandPrice, getVendorBrandPrices, deleteVendor, renameVendor } from './vendors';

describe('vendors domain', () => {
  it('createVendor + listVendors excludes archived by default', async () => {
    const db = createTestDb();
    const v = await createVendor(db, 'Vasya');
    await archiveVendor(db, v.id);
    const active = await listVendors(db);
    const all = await listVendors(db, { includeArchived: true });
    expect(active).toHaveLength(0);
    expect(all).toHaveLength(1);
  });

  it('setVendorBrandPrice upserts on repeat calls', async () => {
    const db = createTestDb();
    const v = await createVendor(db, 'Vasya');
    const brand = await createBrand(db, 'DarkSide');
    await setVendorBrandPrice(db, v.id, brand.id, 18);
    await setVendorBrandPrice(db, v.id, brand.id, 20);
    const prices = await getVendorBrandPrices(db, v.id);
    expect(prices).toEqual([
      { vendorId: v.id, brandId: brand.id, brandName: 'DarkSide', pricePerKgEur: 20 },
    ]);
  });
});

describe('deleteVendor', () => {
  it('really deletes a vendor nobody ordered from, with its prices and stock', async () => {
    const db = createTestDb();
    const vendor = await createVendor(db, 'Vasya');
    const brand = await createBrand(db, 'DarkSide');
    await setVendorBrandPrice(db, vendor.id, brand.id, 42);
    const w250 = (await getWeights(db)).find((w) => w.grams === 250)!;
    await replaceAvailability(db, {
      vendorId: vendor.id,
      brandId: brand.id,
      weightId: w250.id,
      entries: [{ name: 'Needls', available: true }],
    });

    expect(await deleteVendor(db, vendor.id)).toBe('deleted');
    expect(await listVendors(db, { includeArchived: true })).toEqual([]);
    expect(await getVendorBrandPrices(db, vendor.id)).toEqual([]);
    expect(await listVendorAssortment(db, vendor.id)).toEqual([]);
  });

  it('archives instead of deleting when the vendor has history', async () => {
    const db = createTestDb();
    const [admin] = await db
      .insert(users)
      .values({ telegramId: 'a1', displayName: 'Admin', role: 'admin', firstSeenAt: new Date().toISOString() })
      .returning()
      .all();
    const vendor = await createVendor(db, 'Vasya');
    await createOrder(db, vendor.id, admin.id);

    // Deleting the row would break the order that points at it (spec §10).
    expect(await deleteVendor(db, vendor.id)).toBe('archived');
    expect(await listVendors(db)).toEqual([]);
    expect(await listVendors(db, { includeArchived: true })).toHaveLength(1);
  });

  it('refuses to delete a vendor that does not exist', async () => {
    const db = createTestDb();
    await expect(deleteVendor(db, 999)).rejects.toThrow('vendor not found');
  });
});

describe('renameVendor', () => {
  it('renames', async () => {
    const db = createTestDb();
    const vendor = await createVendor(db, 'Vasya');
    expect((await renameVendor(db, vendor.id, '  Boss Shisha ')).name).toBe('Boss Shisha');
  });

  it('refuses an empty name', async () => {
    const db = createTestDb();
    const vendor = await createVendor(db, 'Vasya');
    await expect(renameVendor(db, vendor.id, '   ')).rejects.toThrow('cannot be empty');
  });
});
