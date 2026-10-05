import { describe, it, expect, vi } from 'vitest';
import Fastify from 'fastify';
import { createTestDb, schema } from '../../db/client';
import { createVendor, setVendorBrandPrice } from '../../domain/vendors';
import { createBrand, getWeights } from '../../domain/catalog';
import { replaceAvailability } from '../../domain/availability';
import { createOrder, getOrder } from '../../domain/orders';
import { upsertOrderItem } from '../../domain/orderItems';
import { listChecklist, adjustReceivedQty } from '../../domain/checklist';
import { ordersRoutes } from './orders';
import type { AuthedUser } from '../middleware/authenticate';
import type { OrderAnnouncer } from '../../telegram/notify';

const admin: AuthedUser = { id: 1, telegramId: '1', displayName: 'Admin', role: 'admin' };
const friend: AuthedUser = { id: 2, telegramId: '2', displayName: 'Friend', role: 'member' };

function announcer(): OrderAnnouncer {
  return {
    announceOrderOpened: vi.fn().mockResolvedValue(undefined),
    announceStatusChanged: vi.fn().mockResolvedValue(undefined),
    announceReadiness: vi.fn().mockResolvedValue(undefined),
  };
}

function testApp(user: AuthedUser, db: ReturnType<typeof createTestDb>, ann = announcer()) {
  const app = Fastify();
  app.addHook('preHandler', async (req) => {
    req.authedUser = user;
  });
  app.setErrorHandler((err, req, reply) =>
    reply.code(err.statusCode ?? 400).send({ error: (err as Error).message })
  );
  app.register(ordersRoutes(db, ann), { prefix: '/api/orders' });
  return app;
}

async function seedVendorWithStock(db: ReturnType<typeof createTestDb>, vendorName = 'Vasya') {
  if (!(await db.select().from(schema.users).all()).length) {
    await db
      .insert(schema.users)
      .values([
        { telegramId: '1', displayName: 'Admin', role: 'admin', firstSeenAt: new Date().toISOString() },
        { telegramId: '2', displayName: 'Friend', role: 'member', firstSeenAt: new Date().toISOString() },
      ])
      .run();
  }

  const vendor = await createVendor(db, vendorName);
  const brand = await createBrand(db, `DarkSide-${vendorName}`);
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
  it('GET / lists nothing while no order is open', async () => {
    const db = createTestDb();
    const app = testApp(friend, db);
    const res = await app.inject({ method: 'GET', url: '/api/orders' });
    expect(res.json()).toEqual([]);
  });

  it('lists one active order per vendor and announces each one', async () => {
    const db = createTestDb();
    const a = await seedVendorWithStock(db, 'Vasya');
    const b = await seedVendorWithStock(db, 'Petya');
    const ann = announcer();
    const app = testApp(admin, db, ann);

    await app.inject({ method: 'POST', url: '/api/orders', payload: { vendorId: a.vendor.id } });
    await app.inject({ method: 'POST', url: '/api/orders', payload: { vendorId: b.vendor.id } });

    const list = await app.inject({ method: 'GET', url: '/api/orders' });
    expect(list.json()).toHaveLength(2);
    expect(ann.announceOrderOpened).toHaveBeenCalledTimes(2);
  });

  /**
   * Telegram refusing the message does not un-create the order. Reporting the
   * request as failed left the admin looking at an error while the order sat
   * there, invisible until a manual refresh.
   */
  it('opens the order even when the group announcement fails', async () => {
    const db = createTestDb();
    const { vendor } = await seedVendorWithStock(db);
    const ann = announcer();
    vi.mocked(ann.announceOrderOpened).mockRejectedValue(
      new Error('Call to sendMessage failed! (400: BUTTON_TYPE_INVALID)')
    );
    const app = testApp(admin, db, ann);

    const res = await app.inject({ method: 'POST', url: '/api/orders', payload: { vendorId: vendor.id } });

    expect(res.statusCode).toBe(201);
    expect((await app.inject({ method: 'GET', url: '/api/orders' })).json()).toHaveLength(1);
  });

  it('announces every status change, and survives that failing too', async () => {
    const db = createTestDb();
    const { vendor } = await seedVendorWithStock(db);
    const ann = announcer();
    const app = testApp(admin, db, ann);
    const created = await app.inject({ method: 'POST', url: '/api/orders', payload: { vendorId: vendor.id } });
    const orderId = created.json().id;

    const closed = await app.inject({
      method: 'POST',
      url: `/api/orders/${orderId}/status`,
      payload: { status: 'awaiting_validation' },
    });
    expect(closed.statusCode).toBe(200);
    expect(ann.announceStatusChanged).toHaveBeenCalledWith('Vasya', orderId, 'awaiting_validation');

    vi.mocked(ann.announceStatusChanged).mockRejectedValue(new Error('telegram is down'));
    const finished = await app.inject({ method: 'POST', url: `/api/orders/${orderId}/finish`, payload: {} });
    expect(finished.statusCode).toBe(200);
    expect((await getOrder(db, orderId))!.status).toBe('done');
  });

  it('refuses a second order at the same vendor', async () => {
    const db = createTestDb();
    const { vendor } = await seedVendorWithStock(db);
    const app = testApp(admin, db);

    await app.inject({ method: 'POST', url: '/api/orders', payload: { vendorId: vendor.id } });
    const second = await app.inject({ method: 'POST', url: '/api/orders', payload: { vendorId: vendor.id } });

    expect(second.statusCode).toBe(400);
    expect(second.json().error).toContain('already has an active order');
  });

  it('refuses to open an order for a non-admin', async () => {
    const db = createTestDb();
    const { vendor } = await seedVendorWithStock(db);
    const app = testApp(friend, db);
    const res = await app.inject({ method: 'POST', url: '/api/orders', payload: { vendorId: vendor.id } });
    expect(res.statusCode).toBe(403);
  });

  it('full flow: assortment shows the item, PUT creates it, GET /mine totals it', async () => {
    const db = createTestDb();
    const { vendor, brand, w250, flavorId } = await seedVendorWithStock(db);
    const order = await createOrder(db, vendor.id, admin.id);
    const app = testApp(friend, db);

    const assortment = await app.inject({ method: 'GET', url: `/api/orders/${order.id}/assortment` });
    expect(assortment.json()).toEqual([
      expect.objectContaining({ flavorName: 'CyberKiwi', grams: 250, available: true }),
    ]);

    await app.inject({
      method: 'PUT',
      url: `/api/orders/${order.id}/items`,
      payload: { brandId: brand.id, flavorId, weightId: w250.id, quantity: 3 },
    });

    const mine = await app.inject({ method: 'GET', url: `/api/orders/${order.id}/mine` });
    expect(mine.json()).toMatchObject({ totalKg: 0.75, totalEur: 15, hasUnavailableItems: false, ready: false });
    expect(mine.json().items).toHaveLength(1);
  });

  it('404s for an order that does not exist', async () => {
    const db = createTestDb();
    const app = testApp(friend, db);
    const res = await app.inject({ method: 'GET', url: '/api/orders/999/mine' });
    expect(res.statusCode).toBe(404);
  });

  it('marks the participant ready and drops the mark when they edit again', async () => {
    const db = createTestDb();
    const { vendor, brand, w250, flavorId } = await seedVendorWithStock(db);
    const order = await createOrder(db, vendor.id, admin.id);
    const app = testApp(friend, db);

    await app.inject({ method: 'POST', url: `/api/orders/${order.id}/ready`, payload: { ready: true } });
    let mine = await app.inject({ method: 'GET', url: `/api/orders/${order.id}/mine` });
    expect(mine.json().ready).toBe(true);

    await app.inject({
      method: 'PUT',
      url: `/api/orders/${order.id}/items`,
      payload: { brandId: brand.id, flavorId, weightId: w250.id, quantity: 1 },
    });
    mine = await app.inject({ method: 'GET', url: `/api/orders/${order.id}/mine` });
    expect(mine.json().ready).toBe(false);
  });

  it('tells the group when a participant becomes ready or takes it back, once per real change', async () => {
    const db = createTestDb();
    const { vendor, brand, w250, flavorId } = await seedVendorWithStock(db);
    const order = await createOrder(db, vendor.id, admin.id);
    const ann = announcer();
    const app = testApp(friend, db, ann);
    await app.inject({
      method: 'PUT',
      url: `/api/orders/${order.id}/items`,
      payload: { brandId: brand.id, flavorId, weightId: w250.id, quantity: 1 },
    });

    const ready = (value: boolean) =>
      app.inject({ method: 'POST', url: `/api/orders/${order.id}/ready`, payload: { ready: value } });
    await ready(true);
    await ready(true);
    await ready(false);

    expect(ann.announceReadiness).toHaveBeenCalledTimes(2);
    expect(ann.announceReadiness).toHaveBeenNthCalledWith(1, {
      vendorName: 'Vasya',
      orderId: order.id,
      participantName: 'Friend',
      ready: true,
      readyCount: 1,
      totalParticipants: 1,
    });
    expect(ann.announceReadiness).toHaveBeenNthCalledWith(2, expect.objectContaining({ ready: false, readyCount: 0 }));
  });

  it('closes collection, which builds the checklist and locks participants out', async () => {
    const db = createTestDb();
    const { vendor, brand, w250, flavorId } = await seedVendorWithStock(db);
    const order = await createOrder(db, vendor.id, admin.id);
    await upsertOrderItem(db, {
      orderId: order.id,
      userId: friend.id,
      brandId: brand.id,
      flavorId,
      weightId: w250.id,
      quantity: 2,
    });

    const adminApp = testApp(admin, db);
    await adminApp.inject({
      method: 'POST',
      url: `/api/orders/${order.id}/status`,
      payload: { status: 'awaiting_validation' },
    });

    expect(await listChecklist(db, order.id)).toEqual([
      expect.objectContaining({ expectedQty: 2, receivedQty: 0 }),
    ]);

    const memberApp = testApp(friend, db);
    const blocked = await memberApp.inject({
      method: 'PUT',
      url: `/api/orders/${order.id}/items`,
      payload: { brandId: brand.id, flavorId, weightId: w250.id, quantity: 5 },
    });
    expect(blocked.statusCode).toBe(400);
    expect(blocked.json().error).toContain('adding positions is closed');
  });

  it('lets the admin add a line for someone else once the order is on validation', async () => {
    const db = createTestDb();
    const { vendor, brand, w250, flavorId } = await seedVendorWithStock(db);
    const order = await createOrder(db, vendor.id, admin.id);
    const app = testApp(admin, db);
    await app.inject({
      method: 'POST',
      url: `/api/orders/${order.id}/status`,
      payload: { status: 'awaiting_validation' },
    });

    const res = await app.inject({
      method: 'PUT',
      url: `/api/orders/${order.id}/items`,
      payload: { brandId: brand.id, flavorId, weightId: w250.id, quantity: 1, userId: friend.id },
    });

    expect(res.json().item).toMatchObject({ userId: friend.id, addedByUserId: admin.id, quantity: 1 });
  });

  it('returning an order to collecting clears readiness and any recorded delivery', async () => {
    const db = createTestDb();
    const { vendor, brand, w250, flavorId } = await seedVendorWithStock(db);
    const order = await createOrder(db, vendor.id, admin.id);
    const memberApp = testApp(friend, db);
    await memberApp.inject({
      method: 'PUT',
      url: `/api/orders/${order.id}/items`,
      payload: { brandId: brand.id, flavorId, weightId: w250.id, quantity: 2 },
    });
    await memberApp.inject({ method: 'POST', url: `/api/orders/${order.id}/ready`, payload: { ready: true } });

    const adminApp = testApp(admin, db);
    await adminApp.inject({
      method: 'POST',
      url: `/api/orders/${order.id}/status`,
      payload: { status: 'awaiting_validation' },
    });
    await adminApp.inject({
      method: 'POST',
      url: `/api/orders/${order.id}/status`,
      payload: { status: 'ordering' },
    });

    const mine = await memberApp.inject({ method: 'GET', url: `/api/orders/${order.id}/mine` });
    expect(mine.json().ready).toBe(false);
    expect(mine.json().items[0].deliveredQty).toBeNull();
  });

  it('finishes an order that matched the delivery, billing what was ordered', async () => {
    const db = createTestDb();
    const { vendor, brand, w250, flavorId } = await seedVendorWithStock(db);
    const order = await createOrder(db, vendor.id, admin.id);
    await upsertOrderItem(db, {
      orderId: order.id,
      userId: friend.id,
      brandId: brand.id,
      flavorId,
      weightId: w250.id,
      quantity: 2,
    });

    const app = testApp(admin, db);
    await app.inject({
      method: 'POST',
      url: `/api/orders/${order.id}/status`,
      payload: { status: 'awaiting_validation' },
    });
    const [entry] = await listChecklist(db, order.id);
    await adjustReceivedQty(db, entry.id, 2);

    const finished = await app.inject({ method: 'POST', url: `/api/orders/${order.id}/finish`, payload: {} });

    expect(finished.json().status).toBe('done');
    const memberApp = testApp(friend, db);
    const mine = await memberApp.inject({ method: 'GET', url: `/api/orders/${order.id}/mine` });
    expect(mine.json().items[0].deliveredQty).toBe(2);
    expect(mine.json().totalEur).toBe(10);
  });

  it('refuses to finish while a shortfall is still unassigned', async () => {
    const db = createTestDb();
    const { vendor, brand, w250, flavorId } = await seedVendorWithStock(db);
    const order = await createOrder(db, vendor.id, admin.id);
    await upsertOrderItem(db, {
      orderId: order.id,
      userId: friend.id,
      brandId: brand.id,
      flavorId,
      weightId: w250.id,
      quantity: 2,
    });

    const app = testApp(admin, db);
    await app.inject({
      method: 'POST',
      url: `/api/orders/${order.id}/status`,
      payload: { status: 'awaiting_validation' },
    });
    const [entry] = await listChecklist(db, order.id);
    await adjustReceivedQty(db, entry.id, 1); // one pack short

    const res = await app.inject({ method: 'POST', url: `/api/orders/${order.id}/finish`, payload: {} });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toContain('must be distributed');
    expect((await getOrder(db, order.id))!.status).toBe('awaiting_validation');
  });

  it('finishes a short delivery once the admin says whose pack is missing', async () => {
    const db = createTestDb();
    const { vendor, brand, w250, flavorId } = await seedVendorWithStock(db);
    const order = await createOrder(db, vendor.id, admin.id);
    await upsertOrderItem(db, { orderId: order.id, userId: friend.id, brandId: brand.id, flavorId, weightId: w250.id, quantity: 1 });
    await upsertOrderItem(db, { orderId: order.id, userId: admin.id, brandId: brand.id, flavorId, weightId: w250.id, quantity: 1 });

    const app = testApp(admin, db);
    await app.inject({
      method: 'POST',
      url: `/api/orders/${order.id}/status`,
      payload: { status: 'awaiting_validation' },
    });
    const [entry] = await listChecklist(db, order.id);
    await adjustReceivedQty(db, entry.id, 1); // 1 of 2 arrived

    const groups = await app.inject({ method: 'GET', url: `/api/orders/${order.id}/discrepancies` });
    expect(groups.json()).toHaveLength(1);
    const participants = groups.json()[0].participants;
    expect(participants).toHaveLength(2);

    const mine = participants.find((p: { userId: number }) => p.userId === friend.id)!;
    const theirs = participants.find((p: { userId: number }) => p.userId === admin.id)!;
    const res = await app.inject({
      method: 'POST',
      url: `/api/orders/${order.id}/finish`,
      payload: {
        allocations: [
          { orderItemId: mine.orderItemId, deliveredQty: 1 },
          { orderItemId: theirs.orderItemId, deliveredQty: 0 },
        ],
      },
    });

    expect(res.json().status).toBe('done');
    const memberApp = testApp(friend, db);
    const friendSummary = await memberApp.inject({ method: 'GET', url: `/api/orders/${order.id}/mine` });
    expect(friendSummary.json().totalEur).toBe(5);
    const adminSummary = await app.inject({ method: 'GET', url: `/api/orders/${order.id}/mine` });
    expect(adminSummary.json().totalEur).toBe(0);
  });

  it('never moves an order out of done', async () => {
    const db = createTestDb();
    const { vendor } = await seedVendorWithStock(db);
    const order = await createOrder(db, vendor.id, admin.id);
    const app = testApp(admin, db);
    await app.inject({
      method: 'POST',
      url: `/api/orders/${order.id}/status`,
      payload: { status: 'awaiting_validation' },
    });
    await app.inject({ method: 'POST', url: `/api/orders/${order.id}/finish`, payload: {} });

    const res = await app.inject({
      method: 'POST',
      url: `/api/orders/${order.id}/status`,
      payload: { status: 'ordering' },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toContain('cannot move an order from done to ordering');
  });

  it('cancels an order and frees the vendor for a new one', async () => {
    const db = createTestDb();
    const { vendor } = await seedVendorWithStock(db);
    const order = await createOrder(db, vendor.id, admin.id);
    const app = testApp(admin, db);

    await app.inject({
      method: 'POST',
      url: `/api/orders/${order.id}/status`,
      payload: { status: 'rejected' },
    });

    const again = await app.inject({ method: 'POST', url: '/api/orders', payload: { vendorId: vendor.id } });
    expect(again.statusCode).toBe(201);
  });
});
