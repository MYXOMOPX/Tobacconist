import { eq } from 'drizzle-orm';
import type { Db } from '../db/client';
import { purchaseRounds, roundBrandPriceSnapshots, vendorBrandPrices } from '../db/schema';

export type Round = typeof purchaseRounds.$inferSelect;

export async function getActiveRound(db: Db): Promise<Round | null> {
  const row = await db.select().from(purchaseRounds).where(eq(purchaseRounds.status, 'open')).get();
  return row ?? null;
}

export async function getRound(db: Db, roundId: number): Promise<Round | null> {
  const row = await db.select().from(purchaseRounds).where(eq(purchaseRounds.id, roundId)).get();
  return row ?? null;
}

export async function openRound(db: Db, vendorId: number, openedByUserId: number) {
  const active = await getActiveRound(db);
  if (active) throw new Error('a round is already open');

  const now = new Date().toISOString();
  const [round] = await db
    .insert(purchaseRounds)
    .values({ vendorId, status: 'open', openedAt: now, openedByUserId })
    .returning()
    .all();

  const prices = await db
    .select()
    .from(vendorBrandPrices)
    .where(eq(vendorBrandPrices.vendorId, vendorId))
    .all();

  for (const p of prices) {
    await db
      .insert(roundBrandPriceSnapshots)
      .values({ roundId: round.id, brandId: p.brandId, pricePerKgEur: p.pricePerKgEur })
      .run();
  }

  return round;
}

export async function closeRound(db: Db, roundId: number) {
  const round = await getRound(db, roundId);
  if (!round) throw new Error('round not found');
  if (round.status === 'closed') throw new Error('round is already closed');
  await db
    .update(purchaseRounds)
    .set({ status: 'closed', closedAt: new Date().toISOString() })
    .where(eq(purchaseRounds.id, roundId))
    .run();
}

export async function reopenRound(db: Db, roundId: number) {
  const round = await getRound(db, roundId);
  if (!round) throw new Error('round not found');
  if (round.status !== 'closed') throw new Error('round is not closed');
  const active = await getActiveRound(db);
  if (active) throw new Error('a different round is already open');
  await db
    .update(purchaseRounds)
    .set({ status: 'open', closedAt: null })
    .where(eq(purchaseRounds.id, roundId))
    .run();
}

export async function getRoundPriceSnapshot(db: Db, roundId: number, brandId: number) {
  const row = await db
    .select()
    .from(roundBrandPriceSnapshots)
    .where(eq(roundBrandPriceSnapshots.roundId, roundId))
    .all();
  return row.find((r) => r.brandId === brandId)?.pricePerKgEur ?? null;
}
