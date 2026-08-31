import { describe, it, expect } from 'vitest';
import Fastify from 'fastify';
import { createTestDb } from '../../db/client';
import { createVendor, setVendorBrandPrice } from '../../domain/vendors';
import { createBrand, getWeights } from '../../domain/catalog';
import { replaceAvailability } from '../../domain/availability';
import { createOrder } from '../../domain/orders';
import { upsertOrderItem } from '../../domain/orderItems';
import { setPaymentStatus } from '../../domain/participants';
import { users } from '../../db/schema';
import { summariesRoutes } from './summaries';
import type { AuthedUser } from '../middleware/authenticate';

const admin: AuthedUser = { id: 1, telegramId: '1', displayName: 'Admin', role: 'admin' };
const member: AuthedUser = { id: 2, telegramId: '2', displayName: 'Friend', role: 'member' };

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
  app.register(summariesRoutes(db), { prefix: '/api/orders/:orderId/summaries' });
  return app;
}

async function seed() {
  const db = createTestDb();
  await db
    .insert(users)
    .values({ id: 1, telegramId: '1', displayName: 'Admin', role: 'admin', firstSeenAt: new Date().toISOString() })
    .run();
  await db
    .insert(users)
    .values({ id: 2, telegramId: '2', displayName: 'Friend', role: 'member', firstSeenAt: new Date().toISOString() })
    .run();
  const vendor = await createVendor(db, 'Vasya');
  const brand = await createBrand(db, 'DarkSide');
  await setVendorBrandPrice(db, vendor.id, brand.id, 20); // 20 EUR/kg -> 5 EUR per 250g pack
  const w250 = (await getWeights(db)).find((w) => w.grams === 250)!;
  const [{ flavorId }] = await replaceAvailability(db, {
    vendorId: vendor.id,
    brandId: brand.id,
    weightId: w250.id,
    entries: [{ name: 'CyberKiwi', available: true }],
  });
  const order = await createOrder(db, vendor.id, admin.id);
  return { db, vendor, brand, w250, flavorId, order };
}

describe('summaries route', () => {
  it('returns kg/eur totals and paid status per participant', async () => {
    const { db, brand, w250, flavorId, order } = await seed();
    await upsertOrderItem(db, { orderId: order.id, userId: 2, brandId: brand.id, flavorId, weightId: w250.id, quantity: 3 });
    await upsertOrderItem(db, { orderId: order.id, userId: 1, brandId: brand.id, flavorId, weightId: w250.id, quantity: 1 });
    await setPaymentStatus(db, order.id, 2, true, 1);

    const app = testApp(admin, db);
    const res = await app.inject({ method: 'GET', url: `/api/orders/${order.id}/summaries` });
    expect(res.statusCode).toBe(200);
    const rows = res.json();
    expect(rows).toHaveLength(2);
    expect(rows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ userId: 2, displayName: 'Friend', totalKg: 0.75, totalEur: 15, paid: true, ready: false }),
        expect.objectContaining({ userId: 1, displayName: 'Admin', totalKg: 0.25, totalEur: 5, paid: false, ready: false }),
      ])
    );
  });

  it('lists a participant who was never marked either way as unpaid', async () => {
    const { db, brand, w250, flavorId, order } = await seed();
    await upsertOrderItem(db, { orderId: order.id, userId: 2, brandId: brand.id, flavorId, weightId: w250.id, quantity: 1 });

    const app = testApp(admin, db);
    const res = await app.inject({ method: 'GET', url: `/api/orders/${order.id}/summaries` });
    expect(res.json()).toEqual([
      expect.objectContaining({ userId: 2, displayName: 'Friend', totalKg: 0.25, totalEur: 5, paid: false, ready: false }),
    ]);
  });

  it('rejects non-admin members with 403', async () => {
    const { db, brand, w250, flavorId, order } = await seed();
    await upsertOrderItem(db, { orderId: order.id, userId: 2, brandId: brand.id, flavorId, weightId: w250.id, quantity: 1 });

    const app = testApp(member, db);
    const res = await app.inject({ method: 'GET', url: `/api/orders/${order.id}/summaries` });
    expect(res.statusCode).toBe(403);
  });
});
