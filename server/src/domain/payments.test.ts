import { describe, it, expect } from 'vitest';
import { createTestDb } from '../db/client';
import { users, vendors, purchaseRounds } from '../db/schema';
import { setPaymentStatus, getPaymentStatus } from './payments';

async function setup() {
  const db = createTestDb();
  const [admin] = await db.insert(users).values({ telegramId: 'a1', displayName: 'Admin', role: 'admin', firstSeenAt: new Date().toISOString() }).returning().all();
  const [friend] = await db.insert(users).values({ telegramId: 'f1', displayName: 'Friend', role: 'member', firstSeenAt: new Date().toISOString() }).returning().all();
  const [vendor] = await db.insert(vendors).values({ name: 'Test Vendor' }).returning().all();
  const [round] = await db.insert(purchaseRounds).values({ vendorId: vendor.id, status: 'open', openedAt: new Date().toISOString(), openedByUserId: admin.id }).returning().all();
  return { db, admin, friend, round };
}

describe('payments domain', () => {
  it('defaults to unpaid when no row exists', async () => {
    const { db, friend, round } = await setup();
    expect(await getPaymentStatus(db, round.id, friend.id)).toBe(false);
  });

  it('setPaymentStatus upserts and getPaymentStatus reflects it', async () => {
    const { db, admin, friend, round } = await setup();
    await setPaymentStatus(db, round.id, friend.id, true, admin.id);
    expect(await getPaymentStatus(db, round.id, friend.id)).toBe(true);
    await setPaymentStatus(db, round.id, friend.id, false, admin.id);
    expect(await getPaymentStatus(db, round.id, friend.id)).toBe(false);
  });
});
