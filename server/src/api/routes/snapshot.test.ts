// server/src/api/routes/snapshot.test.ts
import { describe, it, expect, vi } from 'vitest';
import Fastify from 'fastify';
import { createTestDb, schema } from '../../db/client';
import { createVendor, setVendorBrandPrice } from '../../domain/vendors';
import { createBrand, getWeights } from '../../domain/catalog';
import { replaceAvailability } from '../../domain/availability';
import { createOrder } from '../../domain/orders';
import { upsertOrderItem } from '../../domain/orderItems';
import { snapshotRoutes } from './snapshot';
import type { AuthedUser } from '../middleware/authenticate';
import type { DocumentSender } from '../../telegram/notify';

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

function testApp(user: AuthedUser, db: ReturnType<typeof createTestDb>, documentSender: DocumentSender) {
  const app = Fastify();
  app.addHook('preHandler', async (req) => {
    req.authedUser = user;
  });
  app.register(snapshotRoutes(db, documentSender), { prefix: '/api/orders/:orderId/snapshot' });
  return app;
}

describe('snapshot routes', () => {
  it('GET / returns text and table for the order', async () => {
    const { db, order } = await seedOrderWithLines();
    const app = testApp(admin, db, { sendDocument: vi.fn() });
    const res = await app.inject({ method: 'GET', url: `/api/orders/${order.id}/snapshot` });
    expect(res.statusCode).toBe(200);
    expect(res.json().text).toContain('DarkSide - CyberKiwi - 250g - x3');
    expect(res.json().table).toEqual([
      { brand: 'DarkSide', flavor: 'CyberKiwi', weight: '250g', quantity: 3, totalEur: 15 },
    ]);
  });

  it('POST /export builds an XLSX and DMs it to the calling admin', async () => {
    const { db, order } = await seedOrderWithLines();
    const sendDocument = vi.fn().mockResolvedValue(undefined);
    const app = testApp(admin, db, { sendDocument });
    const res = await app.inject({ method: 'POST', url: `/api/orders/${order.id}/snapshot/export` });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ sent: true });
    expect(sendDocument).toHaveBeenCalledTimes(1);
    expect(sendDocument.mock.calls[0][0]).toBe('1');
    expect(sendDocument.mock.calls[0][2]).toBe(`order-${order.id}.xlsx`);
  });

  it('rejects a non-admin user with 403', async () => {
    const { db, order } = await seedOrderWithLines();
    const app = testApp(member, db, { sendDocument: vi.fn() });
    const res = await app.inject({ method: 'GET', url: `/api/orders/${order.id}/snapshot` });
    expect(res.statusCode).toBe(403);
  });
});
