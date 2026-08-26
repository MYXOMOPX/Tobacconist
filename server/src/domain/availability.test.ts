import { describe, it, expect } from 'vitest';
import { createTestDb } from '../db/client';
import { createVendor } from './vendors';
import { createBrand, getWeights } from './catalog';
import { replaceAvailability, isAvailable, listVendorAssortment } from './availability';

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
});
