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

  // Track rows for each flavorId (both existing and newly created)
  const rowsByFlavorId = new Map<number, number>();
  for (const row of existingForTriple) {
    rowsByFlavorId.set(row.vendor_flavor_availability.flavorId, row.vendor_flavor_availability.id);
  }

  const seenFlavorIds = new Set<number>();
  const resultMap = new Map<number, { flavorId: number; flavorName: string; available: boolean }>();

  for (const entry of entries) {
    const flavor = await findOrCreateFlavor(db, brandId, entry.name);
    seenFlavorIds.add(flavor.id);

    const existingRowId = rowsByFlavorId.get(flavor.id);
    if (existingRowId) {
      await db
        .update(vendorFlavorAvailability)
        .set({ available: entry.available, updatedAt: now })
        .where(eq(vendorFlavorAvailability.id, existingRowId))
        .run();
    } else {
      await db
        .insert(vendorFlavorAvailability)
        .values({ vendorId, flavorId: flavor.id, weightId, available: entry.available, updatedAt: now })
        .run();
      // Query for the newly inserted row to track it
      const newRow = await db
        .select({ id: vendorFlavorAvailability.id })
        .from(vendorFlavorAvailability)
        .where(
          and(
            eq(vendorFlavorAvailability.vendorId, vendorId),
            eq(vendorFlavorAvailability.flavorId, flavor.id),
            eq(vendorFlavorAvailability.weightId, weightId)
          )
        )
        .get();
      if (newRow) {
        rowsByFlavorId.set(flavor.id, newRow.id);
      }
    }
    // Only add to result if not already seen in this upload (deduplicate)
    resultMap.set(flavor.id, { flavorId: flavor.id, flavorName: entry.name, available: entry.available });
  }

  for (const row of existingForTriple) {
    const fid = row.vendor_flavor_availability.flavorId;
    if (!seenFlavorIds.has(fid)) {
      await db
        .update(vendorFlavorAvailability)
        .set({ available: false, updatedAt: now })
        .where(eq(vendorFlavorAvailability.id, row.vendor_flavor_availability.id))
        .run();
      resultMap.set(fid, { flavorId: fid, flavorName: row.flavors.name, available: false });
    }
  }

  return Array.from(resultMap.values());
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
