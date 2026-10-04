import { eq, and } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { vendorFlavorAvailability, flavors, brands, weights } from '../db/schema.js';
import { findOrCreateFlavor } from './catalog.js';

export async function replaceAvailability(
  db: Db,
  params: {
    vendorId: number;
    brandId: number;
    weightId: number;
    entries: { name: string; available: boolean }[];
    /** Names were already matched against the catalogue (at /parse): only exact respellings merge. */
    strictNames?: boolean;
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
    const flavor = await findOrCreateFlavor(db, brandId, entry.name, { exactOnly: params.strictNames });
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

/**
 * Sets one position by hand (spec §4). The insurance for when vision misread a
 * flavour, the vendor named it in a message, or something sold out between
 * screenshots — unlike a photo upload, this touches only the position named.
 */
export async function setFlavorAvailability(
  db: Db,
  params: {
    vendorId: number;
    brandId: number;
    weightId: number;
    available: boolean;
    flavorId?: number;
    flavorName?: string;
  }
) {
  const { vendorId, brandId, weightId, available } = params;

  const flavor = params.flavorId
    ? await db.select().from(flavors).where(eq(flavors.id, params.flavorId)).get()
    : params.flavorName?.trim()
      ? await findOrCreateFlavor(db, brandId, params.flavorName.trim())
      : null;
  if (!flavor) throw new Error('flavor not found: pass an existing flavorId or a name to create');
  if (flavor.brandId !== brandId) throw new Error('this flavor belongs to another brand');

  const now = new Date().toISOString();
  const existing = await db
    .select()
    .from(vendorFlavorAvailability)
    .where(
      and(
        eq(vendorFlavorAvailability.vendorId, vendorId),
        eq(vendorFlavorAvailability.flavorId, flavor.id),
        eq(vendorFlavorAvailability.weightId, weightId)
      )
    )
    .get();

  if (existing) {
    await db
      .update(vendorFlavorAvailability)
      .set({ available, updatedAt: now })
      .where(eq(vendorFlavorAvailability.id, existing.id))
      .run();
  } else {
    await db
      .insert(vendorFlavorAvailability)
      .values({ vendorId, flavorId: flavor.id, weightId, available, updatedAt: now })
      .run();
  }

  return { flavorId: flavor.id, flavorName: flavor.name, brandId, weightId, available };
}

export type AvailabilityGroup = {
  brandId: number;
  weightId: number;
  entries: { name: string; available: boolean }[];
};

/**
 * Saves one review session: several screenshots, each already resolved to a
 * brand and a weight by the admin (spec §4).
 *
 * `wipeOthers` is the "this is the vendor's whole range now" switch: everything
 * at this vendor that did not appear in the batch becomes unavailable. Lines
 * already sitting in an active order are never deleted — they just get flagged
 * as no longer stocked (§12), which is what `available = false` does.
 */
export async function applyAvailabilityBatch(
  db: Db,
  params: { vendorId: number; groups: AvailabilityGroup[]; wipeOthers?: boolean }
) {
  const { vendorId, groups } = params;
  const applied = [];
  for (const group of groups) {
    applied.push({
      brandId: group.brandId,
      weightId: group.weightId,
      lines: await replaceAvailability(db, {
        vendorId,
        brandId: group.brandId,
        weightId: group.weightId,
        entries: group.entries,
        strictNames: true,
      }),
    });
  }

  if (params.wipeOthers) {
    const touched = new Set(groups.map((group) => `${group.brandId}:${group.weightId}`));
    const now = new Date().toISOString();
    const rows = await db
      .select({
        id: vendorFlavorAvailability.id,
        weightId: vendorFlavorAvailability.weightId,
        brandId: flavors.brandId,
        available: vendorFlavorAvailability.available,
      })
      .from(vendorFlavorAvailability)
      .innerJoin(flavors, eq(flavors.id, vendorFlavorAvailability.flavorId))
      .where(eq(vendorFlavorAvailability.vendorId, vendorId))
      .all();

    for (const row of rows) {
      if (touched.has(`${row.brandId}:${row.weightId}`) || !row.available) continue;
      await db
        .update(vendorFlavorAvailability)
        .set({ available: false, updatedAt: now })
        .where(eq(vendorFlavorAvailability.id, row.id))
        .run();
    }
  }

  return applied;
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

/**
 * Brand, then flavour, then weight — the order the list is read in, so a person
 * scrolling for one flavour knows where it should be. Sorted here and not in SQL
 * because SQLite compares text byte by byte: that puts Cyrillic after Latin and
 * lowercase after uppercase, which is not the alphabet anybody expects.
 */
export async function listVendorAssortment(
  db: Db,
  vendorId: number,
  opts?: { onlyAvailable?: boolean }
) {
  const byName = (a: string, b: string) => a.localeCompare(b, 'ru');
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

  rows.sort(
    (a, b) =>
      byName(a.brandName, b.brandName) ||
      byName(a.flavorName, b.flavorName) ||
      a.grams - b.grams
  );

  return opts?.onlyAvailable ? rows.filter((r) => r.available) : rows;
}
