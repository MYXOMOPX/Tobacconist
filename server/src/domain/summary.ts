import type { Db } from '../db/client';
import { brands, flavors, weights } from '../db/schema';
import { listUserOrderItems, listRoundOrderItems } from './orders';
import { getRound, getRoundPriceSnapshot } from './rounds';
import { isAvailable } from './availability';
import { packPriceEur } from './catalog';

export type AggregateLine = {
  brandId: number;
  brandName: string;
  flavorId: number;
  flavorName: string;
  weightId: number;
  grams: number;
  quantity: number;
  totalEur: number;
  /** False when the (flavor, weight) pair is no longer stocked by the round's vendor. */
  available: boolean;
};

async function nameLookups(db: Db) {
  const [brandRows, flavorRows, weightRows] = await Promise.all([
    db.select().from(brands).all(),
    db.select().from(flavors).all(),
    db.select().from(weights).all(),
  ]);
  return {
    brandName: (id: number) => brandRows.find((b) => b.id === id)!.name,
    flavorName: (id: number) => flavorRows.find((f) => f.id === id)!.name,
    grams: (id: number) => weightRows.find((w) => w.id === id)!.grams,
  };
}

async function buildLines(
  db: Db,
  roundId: number,
  vendorId: number,
  items: { brandId: number; flavorId: number; weightId: number; quantity: number }[]
): Promise<AggregateLine[]> {
  const lookup = await nameLookups(db);
  const lines: AggregateLine[] = [];
  for (const item of items) {
    const pricePerKg = await getRoundPriceSnapshot(db, roundId, item.brandId);
    if (pricePerKg === null || pricePerKg === undefined) {
      throw new Error(`missing price snapshot for brandId ${item.brandId} in round ${roundId}`);
    }
    const grams = lookup.grams(item.weightId);
    const unitPrice = packPriceEur(pricePerKg, grams);
    lines.push({
      brandId: item.brandId,
      brandName: lookup.brandName(item.brandId),
      flavorId: item.flavorId,
      flavorName: lookup.flavorName(item.flavorId),
      weightId: item.weightId,
      grams,
      quantity: item.quantity,
      totalEur: Math.round(unitPrice * item.quantity * 100) / 100,
      available: await isAvailable(db, vendorId, item.flavorId, item.weightId),
    });
  }
  return lines;
}

function totals(lines: AggregateLine[]) {
  const totalEur = Math.round(lines.reduce((s, l) => s + l.totalEur, 0) * 100) / 100;
  const totalKg = lines.reduce((s, l) => s + (l.grams * l.quantity) / 1000, 0);
  return { totalEur, totalKg };
}

export async function computeUserSummary(db: Db, roundId: number, userId: number) {
  const round = await getRound(db, roundId);
  if (!round) throw new Error('round not found');
  const items = await listUserOrderItems(db, roundId, userId);
  const lines = await buildLines(db, roundId, round.vendorId, items);
  const hasUnavailableItems = lines.some((l) => !l.available);
  return { items: lines, ...totals(lines), hasUnavailableItems };
}

export async function computeAggregateSummary(db: Db, roundId: number) {
  const round = await getRound(db, roundId);
  if (!round) throw new Error('round not found');
  const items = await listRoundOrderItems(db, roundId);
  const grouped = new Map<string, { brandId: number; flavorId: number; weightId: number; quantity: number }>();
  for (const item of items) {
    const key = `${item.brandId}:${item.flavorId}:${item.weightId}`;
    const existing = grouped.get(key);
    if (existing) existing.quantity += item.quantity;
    else grouped.set(key, { brandId: item.brandId, flavorId: item.flavorId, weightId: item.weightId, quantity: item.quantity });
  }
  const lines = await buildLines(db, roundId, round.vendorId, [...grouped.values()]);
  return { lines, ...totals(lines) };
}
