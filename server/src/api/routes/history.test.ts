import { describe, it, expect } from 'vitest';
import Fastify from 'fastify';
import { createTestDb } from '../../db/client';
import { createVendor, setVendorBrandPrice } from '../../domain/vendors';
import { createBrand, getWeights } from '../../domain/catalog';
import { replaceAvailability } from '../../domain/availability';
import { openRound, closeRound } from '../../domain/rounds';
import { upsertOrderItem } from '../../domain/orders';
import { users } from '../../db/schema';
import { historyRoutes } from './history';
import type { AuthedUser } from '../middleware/authenticate';

const admin: AuthedUser = { id: 1, telegramId: '1', displayName: 'Admin', role: 'admin' };
const friend: AuthedUser = { id: 2, telegramId: '2', displayName: 'Friend', role: 'member' };
const bystander: AuthedUser = { id: 3, telegramId: '3', displayName: 'Bystander', role: 'member' };

function testApp(user: AuthedUser, db: ReturnType<typeof createTestDb>) {
  const app = Fastify();
  app.addHook('preHandler', async (req) => {
    req.authedUser = user;
  });
  app.register(historyRoutes(db), { prefix: '/api/history' });
  return app;
}

async function seedClosedRoundWithFriendOrder() {
  const db = createTestDb();
  await db.insert(users).values({ id: 1, telegramId: '1', displayName: 'Admin', role: 'admin', firstSeenAt: new Date().toISOString() }).run();
  await db.insert(users).values({ id: 2, telegramId: '2', displayName: 'Friend', role: 'member', firstSeenAt: new Date().toISOString() }).run();
  const vendor = await createVendor(db, 'Vasya');
  const brand = await createBrand(db, 'DarkSide');
  await setVendorBrandPrice(db, vendor.id, brand.id, 20);
  const w250 = (await getWeights(db)).find((w) => w.grams === 250)!;
  const [{ flavorId }] = await replaceAvailability(db, { vendorId: vendor.id, brandId: brand.id, weightId: w250.id, entries: [{ name: 'CyberKiwi', available: true }] });
  const round = await openRound(db, vendor.id, admin.id);
  await upsertOrderItem(db, { roundId: round.id, userId: friend.id, brandId: brand.id, flavorId, weightId: w250.id, quantity: 2 });
  await closeRound(db, round.id);
  return { db, round };
}

describe('history routes', () => {
  it('a member who did not order in the round does not see it in GET /', async () => {
    const { db, round } = await seedClosedRoundWithFriendOrder();
    const app = testApp(bystander, db);
    const res = await app.inject({ method: 'GET', url: '/api/history' });
    expect(res.json()).toEqual([]);
  });

  it('the member who ordered sees it, and admin sees all closed rounds', async () => {
    const { db, round } = await seedClosedRoundWithFriendOrder();
    const friendRes = await testApp(friend, db).inject({ method: 'GET', url: '/api/history' });
    expect(friendRes.json()).toHaveLength(1);
    const adminRes = await testApp(admin, db).inject({ method: 'GET', url: '/api/history' });
    expect(adminRes.json()).toHaveLength(1);
  });

  it('GET /:roundId returns the caller own summary for that round', async () => {
    const { db, round } = await seedClosedRoundWithFriendOrder();
    const app = testApp(friend, db);
    const res = await app.inject({ method: 'GET', url: `/api/history/${round.id}` });
    expect(res.json()).toMatchObject({ totalKg: 0.5, totalEur: 10, paid: false });
  });
});
