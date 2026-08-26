import { describe, it, expect } from 'vitest';
import { createTestDb } from '../db/client';
import { createBrand } from './catalog';
import {
  createVendor,
  listVendors,
  archiveVendor,
  setVendorBrandPrice,
  getVendorBrandPrices,
} from './vendors';

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
