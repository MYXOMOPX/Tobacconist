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
const member: AuthedUser = { id: 2, telegramId: '2', displayName: 'Member', role: 'member' };

function testApp(user: AuthedUser, db: ReturnType<typeof createTestDb>) {
  const app = Fastify();
  app.setErrorHandler((err, req, reply) => {
    if (err.statusCode) {
      reply.code(err.statusCode).send({ error: err.message });
      return;
    }
    reply.code(400).send({ error: err.message });
  });
  app.addHook('preHandler', async (req) => {
    req.authedUser = user;
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

    const app = testApp(admin, db);
    const list = await app.inject({ method: 'GET', url: `/api/rounds/${round.id}/payments` });
    expect(list.json()).toEqual([{ userId: friend.id, displayName: 'Friend', paid: false }]);

    await app.inject({ method: 'POST', url: `/api/rounds/${round.id}/payments/${friend.id}`, payload: { paid: true } });
    const after = await app.inject({ method: 'GET', url: `/api/rounds/${round.id}/payments` });
    expect(after.json()).toEqual([{ userId: friend.id, displayName: 'Friend', paid: true }]);
  });

  it('GET / and POST /:userId reject non-admin members', async () => {
    const db = createTestDb();
    await db.insert(users).values({ id: 1, telegramId: '1', displayName: 'Admin', role: 'admin', firstSeenAt: new Date().toISOString() }).run();
    await db.insert(users).values({ id: 2, telegramId: '2', displayName: 'Member', role: 'member', firstSeenAt: new Date().toISOString() }).run();
    const vendor = await createVendor(db, 'Vasya');
    const brand = await createBrand(db, 'DarkSide');
    await setVendorBrandPrice(db, vendor.id, brand.id, 20);
    const w250 = (await getWeights(db)).find((w) => w.grams === 250)!;
    const [{ flavorId }] = await replaceAvailability(db, { vendorId: vendor.id, brandId: brand.id, weightId: w250.id, entries: [{ name: 'CyberKiwi', available: true }] });
    const round = await openRound(db, vendor.id, admin.id);
    await upsertOrderItem(db, { roundId: round.id, userId: member.id, brandId: brand.id, flavorId, weightId: w250.id, quantity: 1 });

    const app = testApp(member, db);
    const getRes = await app.inject({ method: 'GET', url: `/api/rounds/${round.id}/payments` });
    expect(getRes.statusCode).toBe(403);

    const postRes = await app.inject({ method: 'POST', url: `/api/rounds/${round.id}/payments/${member.id}`, payload: { paid: true } });
    expect(postRes.statusCode).toBe(403);
  });
});
