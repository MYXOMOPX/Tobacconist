import { eq, and } from 'drizzle-orm';
import type { Db } from '../db/client';
import { vendorFlavorAvailability, flavors, brands, weights } from '../db/schema';
import { findOrCreateFlavor } from './catalog';

export async function replaceAvailability(
  db: Db,
  params: {
    vendorId: number;
    brandId: number;
    weightId: number;
    entries: { name: string; available: boolean }[];
  }
) {
  const { vendorId, brandId, weightId, entries } = params;
  const now = new Date().toISOString();

  const existingForTriple = await db
    .select()
    .from(vendorFlavorAvailability)
    .innerJoin(flavors, eq(flavors.id, vendorFlavorAvailability.flavorId))
    .where(
      and(
        eq(vendorFlavorAvailability.vendorId, vendorId),
        eq(vendorFlavorAvailability.weightId, weightId),
        eq(flavors.brandId, brandId)
      )
    )
    .all();

  const seenFlavorIds = new Set<number>();
  const result: { flavorId: number; flavorName: string; available: boolean }[] = [];

  for (const entry of entries) {
    const flavor = await findOrCreateFlavor(db, brandId, entry.name);
    seenFlavorIds.add(flavor.id);
    const existingRow = existingForTriple.find(
      (r) => r.vendor_flavor_availability.flavorId === flavor.id
    );
    if (existingRow) {
      await db
        .update(vendorFlavorAvailability)
        .set({ available: entry.available, updatedAt: now })
        .where(eq(vendorFlavorAvailability.id, existingRow.vendor_flavor_availability.id))
        .run();
    } else {
      await db
        .insert(vendorFlavorAvailability)
        .values({ vendorId, flavorId: flavor.id, weightId, available: entry.available, updatedAt: now })
        .run();
    }
    result.push({ flavorId: flavor.id, flavorName: entry.name, available: entry.available });
  }

  for (const row of existingForTriple) {
    const fid = row.vendor_flavor_availability.flavorId;
    if (!seenFlavorIds.has(fid)) {
      await db
        .update(vendorFlavorAvailability)
        .set({ available: false, updatedAt: now })
        .where(eq(vendorFlavorAvailability.id, row.vendor_flavor_availability.id))
        .run();
      result.push({ flavorId: fid, flavorName: row.flavors.name, available: false });
    }
  }

  return result;
}

export async function isAvailable(db: Db, vendorId: number, flavorId: number, weightId: number) {
  const row = await db
    .select()
    .from(vendorFlavorAvailability)
    .where(
      and(
        eq(vendorFlavorAvailability.vendorId, vendorId),
        eq(vendorFlavorAvailability.flavorId, flavorId),
        eq(vendorFlavorAvailability.weightId, weightId)
      )
    )
    .get();
  return row?.available ?? false;
}

export async function listVendorAssortment(
  db: Db,
  vendorId: number,
  opts?: { onlyAvailable?: boolean }
) {
  const rows = await db
    .select({
      brandId: brands.id,
      brandName: brands.name,
      flavorId: flavors.id,
      flavorName: flavors.name,
      weightId: weights.id,
      grams: weights.grams,
      available: vendorFlavorAvailability.available,
    })
    .from(vendorFlavorAvailability)
    .innerJoin(flavors, eq(flavors.id, vendorFlavorAvailability.flavorId))
    .innerJoin(brands, eq(brands.id, flavors.brandId))
    .innerJoin(weights, eq(weights.id, vendorFlavorAvailability.weightId))
    .where(eq(vendorFlavorAvailability.vendorId, vendorId))
    .all();
  return opts?.onlyAvailable ? rows.filter((r) => r.available) : rows;
}
