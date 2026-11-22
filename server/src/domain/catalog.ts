import { eq, and, inArray, asc } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import {
  availabilityUploads,
  brands,
  deliveryChecklistItems,
  flavors,
  orderItems,
  orders,
  orderPriceSnapshots,
  vendorBrandPrices,
  vendorFlavorAvailability,
  weights,
} from '../db/schema.js';
import { deleteOrders, isActiveStatus } from './orders.js';
import { matchFlavor } from './flavorMatch.js';

export function packPriceEur(pricePerKgEur: number, grams: number): number {
  return Math.round(pricePerKgEur * (grams / 1000) * 100) / 100;
}

export async function getWeights(db: Db) {
  return db.select().from(weights).orderBy(asc(weights.grams)).all();
}

export async function createBrand(db: Db, name: string) {
  const [row] = await db.insert(brands).values({ name }).returning().all();
  return row;
}

export async function listBrands(db: Db) {
  return db.select().from(brands).all();
}

/**
 * Returns the brand's flavour with this name, creating it only when nothing
 * close exists. "Close" is judged by `matchFlavor`: the same name in another
 * case or alphabet, or one typo away, is the flavour we already have — never a
 * second row for it.
 */
export async function findOrCreateFlavor(
  db: Db,
  brandId: number,
  name: string,
  opts: { exactOnly?: boolean } = {}
) {
  const trimmed = name.trim();
  const known = await listFlavorsByBrand(db, brandId);
  const match = matchFlavor(trimmed, known.map((flavor) => flavor.name));
  if (match.kind === 'exact' || (match.kind === 'near' && !opts.exactOnly)) {
    const found = known.find((flavor) => flavor.name === match.name);
    if (found) return found;
  }
  const [row] = await db.insert(flavors).values({ brandId, name: trimmed }).returning().all();
  return row;
}

/**
 * Loads a brand's flavour list, one name per line. The list is the reference
 * spelling the parser later snaps screenshots to, so it only ever adds: a name
 * that matches an existing flavour is reported as skipped, not duplicated.
 */
export async function importFlavorList(db: Db, brandId: number, text: string) {
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  const added: string[] = [];
  const skipped: string[] = [];
  for (const line of lines) {
    const before = (await listFlavorsByBrand(db, brandId)).length;
    // The list is the authority, so only a respelling of the same name merges;
    // a typo-distance neighbour is a different flavour until proven otherwise.
    await findOrCreateFlavor(db, brandId, line, { exactOnly: true });
    const after = (await listFlavorsByBrand(db, brandId)).length;
    (after > before ? added : skipped).push(line);
  }
  return { added, skipped };
}

export async function listFlavorsByBrand(db: Db, brandId: number) {
  return db.select().from(flavors).where(eq(flavors.brandId, brandId)).all();
}

/**
 * Matches a brand name read off a screenshot against the catalogue.
 *
 * Vision returns what the vendor printed ("DARKSIDE CORE"), which rarely equals
 * the catalogue spelling ("DarkSide"). Comparison ignores case, spaces and
 * punctuation, and accepts one name containing the other — enough for the usual
 * "BRAND + line name" headings. Anything less certain returns null, and the
 * admin picks the brand on the review screen rather than getting a duplicate.
 */
export function normalizeBrandName(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9а-яё]/gi, '');
}

export async function matchBrandByName(db: Db, rawName: string) {
  const needle = normalizeBrandName(rawName);
  if (!needle) return null;
  const all = await listBrands(db);
  const exact = all.find((brand) => normalizeBrandName(brand.name) === needle);
  if (exact) return exact;

  const contained = all
    .filter((brand) => {
      const other = normalizeBrandName(brand.name);
      return other.length >= 3 && (needle.includes(other) || other.includes(needle));
    })
    // The longest overlap wins, so "DarkSide" beats a stray two-letter brand.
    .sort((a, b) => normalizeBrandName(b.name).length - normalizeBrandName(a.name).length);
  return contained[0] ?? null;
}

export async function findOrCreateBrand(db: Db, name: string) {
  const trimmed = name.trim();
  const existing = await db.select().from(brands).where(eq(brands.name, trimmed)).get();
  if (existing) return existing;
  return createBrand(db, trimmed);
}

/**
 * Every order that mentions the brand, in any way: a line, a delivery row or a
 * frozen price. Deleting the brand has to take these with it.
 */
async function ordersOfBrand(db: Db, brandId: number) {
  const ids = new Set<number>();
  const collect = (rows: { orderId: number }[]) => rows.forEach((row) => ids.add(row.orderId));
  collect(await db.select({ orderId: orderItems.orderId }).from(orderItems).where(eq(orderItems.brandId, brandId)).all());
  collect(
    await db
      .select({ orderId: deliveryChecklistItems.orderId })
      .from(deliveryChecklistItems)
      .where(eq(deliveryChecklistItems.brandId, brandId))
      .all()
  );
  collect(
    await db
      .select({ orderId: orderPriceSnapshots.orderId })
      .from(orderPriceSnapshots)
      .where(eq(orderPriceSnapshots.brandId, brandId))
      .all()
  );
  return [...ids];
}

/** What deleting the brand would drag along, so the UI can warn before it happens. */
export async function getBrandUsage(db: Db, brandId: number) {
  const ids = await ordersOfBrand(db, brandId);
  if (ids.length === 0) return { orders: 0, activeOrders: 0 };
  const rows = await db.select().from(orders).where(inArray(orders.id, ids)).all();
  return { orders: rows.length, activeOrders: rows.filter((row) => isActiveStatus(row.status)).length };
}

/**
 * Deletes a brand with its flavours, stock and vendor prices. Orders that
 * mention it are erased as well — but only when the caller says so (`withOrders`);
 * otherwise the call refuses, so a stray request cannot wipe order history.
 */
export async function deleteBrand(db: Db, brandId: number, opts: { withOrders?: boolean } = {}) {
  const brand = await db.select().from(brands).where(eq(brands.id, brandId)).get();
  if (!brand) throw new Error('brand not found');

  const orderIds = await ordersOfBrand(db, brandId);
  if (orderIds.length > 0 && !opts.withOrders) {
    throw new Error('this brand is used in orders');
  }
  await deleteOrders(db, orderIds);

  const flavorIds = (await db.select({ id: flavors.id }).from(flavors).where(eq(flavors.brandId, brandId)).all()).map(
    (row) => row.id
  );
  if (flavorIds.length > 0) {
    await db.delete(vendorFlavorAvailability).where(inArray(vendorFlavorAvailability.flavorId, flavorIds)).run();
  }
  await db.delete(flavors).where(eq(flavors.brandId, brandId)).run();
  await db.delete(vendorBrandPrices).where(eq(vendorBrandPrices.brandId, brandId)).run();
  // An upload record only remembers what the screenshot claimed; it keeps no brand then.
  await db.update(availabilityUploads).set({ brandId: null }).where(eq(availabilityUploads.brandId, brandId)).run();
  await db.delete(brands).where(eq(brands.id, brandId)).run();
  return { deletedOrders: orderIds.length };
}
