import { describe, it, expect } from 'vitest';
import { createTestDb } from '../db/client';
import { createVendor, setVendorBrandPrice } from './vendors';
import { createBrand } from './catalog';
import { users } from '../db/schema';
import {
  openRound,
  closeRound,
  reopenRound,
  getActiveRound,
  getRoundPriceSnapshot,
} from './rounds';

async function setup() {
  const db = createTestDb();
  const [admin] = await db
    .insert(users)
    .values({ telegramId: 't1', displayName: 'Admin', role: 'admin', firstSeenAt: new Date().toISOString() })
    .returning()
    .all();
  const vendor = await createVendor(db, 'Vasya');
  const brand = await createBrand(db, 'DarkSide');
  await setVendorBrandPrice(db, vendor.id, brand.id, 18);
  return { db, admin, vendor, brand };
}

describe('rounds domain', () => {
  it('openRound creates an open round and snapshots current prices', async () => {
    const { db, admin, vendor, brand } = await setup();
    const round = await openRound(db, vendor.id, admin.id);
    expect(round.status).toBe('open');
    expect(await getRoundPriceSnapshot(db, round.id, brand.id)).toBe(18);
  });

  it('rejects opening a second round while one is open', async () => {
    const { db, admin, vendor } = await setup();
    await openRound(db, vendor.id, admin.id);
    await expect(openRound(db, vendor.id, admin.id)).rejects.toThrow(/already open/i);
  });

  it('price snapshot is frozen even if the live price changes later', async () => {
    const { db, admin, vendor, brand } = await setup();
    const round = await openRound(db, vendor.id, admin.id);
    await setVendorBrandPrice(db, vendor.id, brand.id, 25);
    expect(await getRoundPriceSnapshot(db, round.id, brand.id)).toBe(18);
  });

  it('closeRound flips status and clears active round', async () => {
    const { db, admin, vendor } = await setup();
    const round = await openRound(db, vendor.id, admin.id);
    await closeRound(db, round.id);
    expect(await getActiveRound(db)).toBeNull();
  });

  it('closing an already-closed round throws', async () => {
    const { db, admin, vendor } = await setup();
    const round = await openRound(db, vendor.id, admin.id);
    await closeRound(db, round.id);
    await expect(closeRound(db, round.id)).rejects.toThrow(/already closed/i);
  });

  it('reopenRound restores open status', async () => {
    const { db, admin, vendor } = await setup();
    const round = await openRound(db, vendor.id, admin.id);
    await closeRound(db, round.id);
    await reopenRound(db, round.id);
    const active = await getActiveRound(db);
    expect(active?.id).toBe(round.id);
  });

  it('reopenRound rejects when a different round is already open', async () => {
    const { db, admin, vendor } = await setup();
    const roundA = await openRound(db, vendor.id, admin.id);
    await closeRound(db, roundA.id);
    await openRound(db, vendor.id, admin.id); // roundB now open
    await expect(reopenRound(db, roundA.id)).rejects.toThrow(/already open/i);
  });
});
