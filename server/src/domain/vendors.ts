import { eq } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { vendors, vendorBrandPrices, brands, orders, vendorFlavorAvailability } from '../db/schema.js';

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

export async function renameVendor(db: Db, vendorId: number, name: string) {
  const trimmed = name.trim();
  if (!trimmed) throw new Error('vendor name cannot be empty');
  const [row] = await db
    .update(vendors)
    .set({ name: trimmed })
    .where(eq(vendors.id, vendorId))
    .returning()
    .all();
  if (!row) throw new Error('vendor not found');
  return row;
}

/**
 * Removes a vendor as far as it can be removed.
 *
 * A vendor that has taken part in an order cannot actually be deleted — the
 * history references it, and orders are kept whole (§10). Such a vendor is
 * archived instead: it disappears from the pickers but its past orders still
 * read correctly. Only a vendor nobody ever ordered from is really deleted,
 * along with its prices and stock.
 */
export async function deleteVendor(db: Db, vendorId: number): Promise<'deleted' | 'archived'> {
  const vendor = await db.select().from(vendors).where(eq(vendors.id, vendorId)).get();
  if (!vendor) throw new Error('vendor not found');

  const used = await db.select().from(orders).where(eq(orders.vendorId, vendorId)).all();
  if (used.length > 0) {
    await archiveVendor(db, vendorId);
    return 'archived';
  }

  await db
    .delete(vendorFlavorAvailability)
    .where(eq(vendorFlavorAvailability.vendorId, vendorId))
    .run();
  await db.delete(vendorBrandPrices).where(eq(vendorBrandPrices.vendorId, vendorId)).run();
  await db.delete(vendors).where(eq(vendors.id, vendorId)).run();
  return 'deleted';
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
