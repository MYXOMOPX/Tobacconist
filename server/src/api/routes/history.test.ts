import { describe, it, expect } from 'vitest';
import Fastify from 'fastify';
import { createTestDb } from '../../db/client';
import { createVendor, setVendorBrandPrice } from '../../domain/vendors';
import { createBrand, getWeights } from '../../domain/catalog';
import { replaceAvailability } from '../../domain/availability';
import { createOrder, setOrderStatus } from '../../domain/orders';
import { upsertOrderItem } from '../../domain/orderItems';
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

async function seedFinishedOrderWithFriendOrder() {
  const db = createTestDb();
  await db.insert(users).values({ id: 1, telegramId: '1', displayName: 'Admin', role: 'admin', firstSeenAt: new Date().toISOString() }).run();
  await db.insert(users).values({ id: 2, telegramId: '2', displayName: 'Friend', role: 'member', firstSeenAt: new Date().toISOString() }).run();
  const vendor = await createVendor(db, 'Vasya');
  const brand = await createBrand(db, 'DarkSide');
  await setVendorBrandPrice(db, vendor.id, brand.id, 20);
  const w250 = (await getWeights(db)).find((w) => w.grams === 250)!;
  const [{ flavorId }] = await replaceAvailability(db, { vendorId: vendor.id, brandId: brand.id, weightId: w250.id, entries: [{ name: 'CyberKiwi', available: true }] });
  const order = await createOrder(db, vendor.id, admin.id);
  await upsertOrderItem(db, { orderId: order.id, userId: friend.id, brandId: brand.id, flavorId, weightId: w250.id, quantity: 2 });
  await setOrderStatus(db, order.id, 'awaiting_validation');
  await setOrderStatus(db, order.id, 'done');
  return { db, order };
}

async function seedTwoFinishedOrders() {
  const db = createTestDb();
  await db.insert(users).values({ id: 1, telegramId: '1', displayName: 'Admin', role: 'admin', firstSeenAt: new Date().toISOString() }).run();
  await db.insert(users).values({ id: 2, telegramId: '2', displayName: 'Friend', role: 'member', firstSeenAt: new Date().toISOString() }).run();
  await db.insert(users).values({ id: 3, telegramId: '3', displayName: 'Bystander', role: 'member', firstSeenAt: new Date().toISOString() }).run();

  const vendor = await createVendor(db, 'Vasya');
  const brand = await createBrand(db, 'DarkSide');
  await setVendorBrandPrice(db, vendor.id, brand.id, 20);
  const w250 = (await getWeights(db)).find((w) => w.grams === 250)!;
  const [{ flavorId }] = await replaceAvailability(db, { vendorId: vendor.id, brandId: brand.id, weightId: w250.id, entries: [{ name: 'CyberKiwi', available: true }] });

  // Order A, with friend's line, finished — which frees the vendor for the next one.
  const orderA = await createOrder(db, vendor.id, admin.id);
  await upsertOrderItem(db, { orderId: orderA.id, userId: friend.id, brandId: brand.id, flavorId, weightId: w250.id, quantity: 2 });
  await setOrderStatus(db, orderA.id, 'awaiting_validation');
  await setOrderStatus(db, orderA.id, 'done');

  // Order B at the same vendor, with the bystander's line instead.
  const orderB = await createOrder(db, vendor.id, admin.id);
  await upsertOrderItem(db, { orderId: orderB.id, userId: bystander.id, brandId: brand.id, flavorId, weightId: w250.id, quantity: 1 });
  await setOrderStatus(db, orderB.id, 'awaiting_validation');
  await setOrderStatus(db, orderB.id, 'done');

  return { db, orderA, orderB };
}

describe('history routes', () => {
  it('a member who did not take part in the order does not see it in GET /', async () => {
    const { db, order } = await seedFinishedOrderWithFriendOrder();
    const app = testApp(bystander, db);
    const res = await app.inject({ method: 'GET', url: '/api/history' });
    expect(res.json()).toEqual([]);
  });

  it('per-order filtering: a member sees only the orders they took part in', async () => {
    const { db, orderA, orderB } = await seedTwoFinishedOrders();
    // Friend ordered in orderA only, not in orderB
    const friendRes = await testApp(friend, db).inject({ method: 'GET', url: '/api/history' });
    const friendOrders = friendRes.json();
    expect(friendOrders).toHaveLength(1);
    expect(friendOrders[0].id).toBe(orderA.id);

    // Admin sees both finished orders
    const adminRes = await testApp(admin, db).inject({ method: 'GET', url: '/api/history' });
    const adminOrders = adminRes.json();
    expect(adminOrders).toHaveLength(2);
    expect(adminOrders.map((r: any) => r.id)).toContain(orderA.id);
    expect(adminOrders.map((r: any) => r.id)).toContain(orderB.id);
  });

  it('GET /:orderId returns the caller own summary for that order', async () => {
    const { db, order } = await seedFinishedOrderWithFriendOrder();
    const app = testApp(friend, db);
    const res = await app.inject({ method: 'GET', url: `/api/history/${order.id}` });
    expect(res.json()).toMatchObject({ totalKg: 0.5, totalEur: 10, paid: false });
  });

  it('GET /:orderId denies access to a member with no lines in that order', async () => {
    const { db, orderA, orderB } = await seedTwoFinishedOrders();
    // Friend ordered in orderA but not orderB
    const app = testApp(friend, db);
    const res = await app.inject({ method: 'GET', url: `/api/history/${orderB.id}` });
    expect(res.statusCode).toBe(404);
  });

  it('GET /:orderId denies access to an order that is still active, even for admins', async () => {
    const db = createTestDb();
    await db.insert(users).values({ id: 1, telegramId: '1', displayName: 'Admin', role: 'admin', firstSeenAt: new Date().toISOString() }).run();
    const vendor = await createVendor(db, 'Vasya');
    const brand = await createBrand(db, 'DarkSide');
    await setVendorBrandPrice(db, vendor.id, brand.id, 20);
    const w250 = (await getWeights(db)).find((w) => w.grams === 250)!;
    const [{ flavorId }] = await replaceAvailability(db, { vendorId: vendor.id, brandId: brand.id, weightId: w250.id, entries: [{ name: 'CyberKiwi', available: true }] });
    const active = await createOrder(db, vendor.id, admin.id);

    const app = testApp(admin, db);
    const res = await app.inject({ method: 'GET', url: `/api/history/${active.id}` });
    expect(res.statusCode).toBe(404);
  });
});
