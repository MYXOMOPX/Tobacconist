import { eq, and } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { weights, brands, flavors } from '../db/schema.js';

export function packPriceEur(pricePerKgEur: number, grams: number): number {
  return Math.round(pricePerKgEur * (grams / 1000) * 100) / 100;
}

export async function getWeights(db: Db) {
  return db.select().from(weights).all();
}

export async function createBrand(db: Db, name: string) {
  const [row] = await db.insert(brands).values({ name }).returning().all();
  return row;
}

export async function listBrands(db: Db) {
  return db.select().from(brands).all();
}

export async function findOrCreateFlavor(db: Db, brandId: number, name: string) {
  const existing = await db
    .select()
    .from(flavors)
    .where(and(eq(flavors.brandId, brandId), eq(flavors.name, name)))
    .get();
  if (existing) return existing;
  const [row] = await db.insert(flavors).values({ brandId, name }).returning().all();
  return row;
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
