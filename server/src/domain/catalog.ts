import { eq, and } from 'drizzle-orm';
import type { Db } from '../db/client';
import { weights, brands, flavors } from '../db/schema';

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
