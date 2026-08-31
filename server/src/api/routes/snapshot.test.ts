// server/src/api/routes/snapshot.test.ts
import { describe, it, expect } from 'vitest';
import Fastify from 'fastify';
import { createTestDb, schema } from '../../db/client';
import { createVendor, setVendorBrandPrice } from '../../domain/vendors';
import { createBrand, getWeights } from '../../domain/catalog';
import { replaceAvailability } from '../../domain/availability';
import { createOrder } from '../../domain/orders';
import { upsertOrderItem } from '../../domain/orderItems';
import { snapshotRoutes } from './snapshot';
import type { AuthedUser } from '../middleware/authenticate';

const admin: AuthedUser = { id: 1, telegramId: '1', displayName: 'Admin', role: 'admin' };
const member: AuthedUser = { id: 2, telegramId: '2', displayName: 'Friend', role: 'member' };

async function seedOrderWithLines() {
  const db = createTestDb();
  // Insert users into the database for foreign key constraints
  await db
    .insert(schema.users)
    .values([
      { telegramId: '1', displayName: 'Admin', role: 'admin', firstSeenAt: new Date().toISOString() },
      { telegramId: '2', displayName: 'Friend', role: 'member', firstSeenAt: new Date().toISOString() },
    ])
    .run();
  const vendor = await createVendor(db, 'Vasya');
  const brand = await createBrand(db, 'DarkSide');
  await setVendorBrandPrice(db, vendor.id, brand.id, 20);
  const w250 = (await getWeights(db)).find((w) => w.grams === 250)!;
  const [{ flavorId }] = await replaceAvailability(db, {
    vendorId: vendor.id,
    brandId: brand.id,
    weightId: w250.id,
    entries: [{ name: 'CyberKiwi', available: true }],
  });
  const order = await createOrder(db, vendor.id, admin.id);
  await upsertOrderItem(db, { orderId: order.id, userId: admin.id, brandId: brand.id, flavorId, weightId: w250.id, quantity: 3 });
  return { db, order };
}

function testApp(user: AuthedUser, db: ReturnType<typeof createTestDb>) {
  const app = Fastify();
  app.addHook('preHandler', async (req) => {
    req.authedUser = user;
  });
  app.register(snapshotRoutes(db), { prefix: '/api/orders/:orderId/snapshot' });
  return app;
}

describe('snapshot routes', () => {
  it('GET / returns text and table for the order', async () => {
    const { db, order } = await seedOrderWithLines();
    const app = testApp(admin, db);
    const res = await app.inject({ method: 'GET', url: `/api/orders/${order.id}/snapshot` });
    expect(res.statusCode).toBe(200);
    expect(res.json().text).toContain('DarkSide - CyberKiwi - 250g - x3');
    expect(res.json().table).toEqual([
      { brand: 'DarkSide', flavor: 'CyberKiwi', weight: '250g', quantity: 3, totalEur: 15 },
    ]);
  });

  it('rejects a non-admin user with 403', async () => {
    const { db, order } = await seedOrderWithLines();
    const app = testApp(member, db);
    const res = await app.inject({ method: 'GET', url: `/api/orders/${order.id}/snapshot` });
    expect(res.statusCode).toBe(403);
  });
});
