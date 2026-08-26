import { describe, it, expect } from 'vitest';
import Fastify from 'fastify';
import { createTestDb, schema } from '../../db/client';
import { createVendor, setVendorBrandPrice } from '../../domain/vendors';
import { createBrand, getWeights } from '../../domain/catalog';
import { replaceAvailability } from '../../domain/availability';
import { openRound } from '../../domain/rounds';
import { ordersRoutes } from './orders';
import type { AuthedUser } from '../middleware/authenticate';

const admin: AuthedUser = { id: 1, telegramId: '1', displayName: 'Admin', role: 'admin' };
const friend: AuthedUser = { id: 2, telegramId: '2', displayName: 'Friend', role: 'member' };

function testApp(user: AuthedUser, db: ReturnType<typeof createTestDb>) {
  const app = Fastify();
  app.addHook('preHandler', async (req) => {
    req.authedUser = user;
  });
  app.setErrorHandler((err, req, reply) => reply.code(400).send({ error: (err as Error).message }));
  app.register(ordersRoutes(db), { prefix: '/api/orders' });
  return app;
}

async function seedVendorWithStock(db: ReturnType<typeof createTestDb>) {
  // Create users for foreign key constraints
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
  return { vendor, brand, w250, flavorId };
}

describe('orders routes', () => {
  it('GET /assortment returns [] when no round is open', async () => {
    const db = createTestDb();
    const app = testApp(friend, db);
    const res = await app.inject({ method: 'GET', url: '/api/orders/assortment' });
    expect(res.json()).toEqual([]);
  });

  it('PUT /items rejects when no round is open', async () => {
    const db = createTestDb();
    const app = testApp(friend, db);
    const res = await app.inject({
      method: 'PUT',
      url: '/api/orders/items',
      payload: { brandId: 1, flavorId: 1, weightId: 1, quantity: 1 },
    });
    expect(res.statusCode).toBe(400);
  });

  it('full flow: assortment shows the item, PUT creates it, GET /mine totals it', async () => {
    const db = createTestDb();
    const { vendor, brand, w250, flavorId } = await seedVendorWithStock(db);
    await openRound(db, vendor.id, admin.id);

    const app = testApp(friend, db);

    const assortment = await app.inject({ method: 'GET', url: '/api/orders/assortment' });
    expect(assortment.json()).toEqual([
      expect.objectContaining({ brandName: 'DarkSide', flavorName: 'CyberKiwi', grams: 250, available: true }),
    ]);

    await app.inject({
      method: 'PUT',
      url: '/api/orders/items',
      payload: { brandId: brand.id, flavorId, weightId: w250.id, quantity: 3 },
    });

    const mine = await app.inject({ method: 'GET', url: '/api/orders/mine' });
    expect(mine.json()).toMatchObject({ totalKg: 0.75, totalEur: 15, hasUnavailableItems: false });
    expect(mine.json().items).toHaveLength(1);
  });
});
