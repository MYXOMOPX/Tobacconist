import { eq } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { vendors, vendorBrandPrices, brands } from '../db/schema.js';

export async function createVendor(db: Db, name: string) {
  const [row] = await db.insert(vendors).values({ name }).returning().all();
  return row;
}

export async function listVendors(db: Db, opts?: { includeArchived?: boolean }) {
  const rows = await db.select().from(vendors).all();
  return opts?.includeArchived ? rows : rows.filter((v) => !v.archived);
}

export async function archiveVendor(db: Db, vendorId: number) {
  await db.update(vendors).set({ archived: true }).where(eq(vendors.id, vendorId)).run();
}

export async function setVendorBrandPrice(
  db: Db,
  vendorId: number,
  brandId: number,
  pricePerKgEur: number
) {
  const existing = await db
    .select()
    .from(vendorBrandPrices)
    .where(
      eq(vendorBrandPrices.vendorId, vendorId)
    )
    .all();
  const row = existing.find((r) => r.brandId === brandId);
  if (row) {
    await db
      .update(vendorBrandPrices)
      .set({ pricePerKgEur })
      .where(eq(vendorBrandPrices.id, row.id))
      .run();
  } else {
    await db.insert(vendorBrandPrices).values({ vendorId, brandId, pricePerKgEur }).run();
  }
  return { vendorId, brandId, pricePerKgEur };
}

export async function getVendorBrandPrices(db: Db, vendorId: number) {
  const rows = await db
    .select({
      vendorId: vendorBrandPrices.vendorId,
      brandId: vendorBrandPrices.brandId,
      brandName: brands.name,
      pricePerKgEur: vendorBrandPrices.pricePerKgEur,
    })
    .from(vendorBrandPrices)
    .innerJoin(brands, eq(brands.id, vendorBrandPrices.brandId))
    .where(eq(vendorBrandPrices.vendorId, vendorId))
    .all();
  return rows;
}
