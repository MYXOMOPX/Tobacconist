import { describe, it, expect } from 'vitest';
import Fastify from 'fastify';
import { createTestDb } from '../../db/client';
import { createVendor, setVendorBrandPrice } from '../../domain/vendors';
import { createBrand, getWeights } from '../../domain/catalog';
import { replaceAvailability } from '../../domain/availability';
import { openRound } from '../../domain/rounds';
import { upsertOrderItem } from '../../domain/orders';
import { users } from '../../db/schema';
import { paymentsRoutes } from './payments';
import type { AuthedUser } from '../middleware/authenticate';

const admin: AuthedUser = { id: 1, telegramId: '1', displayName: 'Admin', role: 'admin' };

function testApp(db: ReturnType<typeof createTestDb>) {
  const app = Fastify();
  app.addHook('preHandler', async (req) => {
    req.authedUser = admin;
  });
  app.register(paymentsRoutes(db), { prefix: '/api/rounds/:roundId/payments' });
  return app;
}

describe('payments routes', () => {
  it('GET / lists participants with default unpaid, POST /:userId marks paid', async () => {
    const db = createTestDb();
    await db.insert(users).values({ id: 1, telegramId: '1', displayName: 'Admin', role: 'admin', firstSeenAt: new Date().toISOString() }).run();
    const [friend] = await db.insert(users).values({ telegramId: '2', displayName: 'Friend', role: 'member', firstSeenAt: new Date().toISOString() }).returning().all();
    const vendor = await createVendor(db, 'Vasya');
    const brand = await createBrand(db, 'DarkSide');
    await setVendorBrandPrice(db, vendor.id, brand.id, 20);
    const w250 = (await getWeights(db)).find((w) => w.grams === 250)!;
    const [{ flavorId }] = await replaceAvailability(db, { vendorId: vendor.id, brandId: brand.id, weightId: w250.id, entries: [{ name: 'CyberKiwi', available: true }] });
    const round = await openRound(db, vendor.id, admin.id);
    await upsertOrderItem(db, { roundId: round.id, userId: friend.id, brandId: brand.id, flavorId, weightId: w250.id, quantity: 1 });

    const app = testApp(db);
    const list = await app.inject({ method: 'GET', url: `/api/rounds/${round.id}/payments` });
    expect(list.json()).toEqual([{ userId: friend.id, displayName: 'Friend', paid: false }]);

    await app.inject({ method: 'POST', url: `/api/rounds/${round.id}/payments/${friend.id}`, payload: { paid: true } });
    const after = await app.inject({ method: 'GET', url: `/api/rounds/${round.id}/payments` });
    expect(after.json()).toEqual([{ userId: friend.id, displayName: 'Friend', paid: true }]);
  });
});
