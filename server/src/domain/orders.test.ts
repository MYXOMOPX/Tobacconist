import { describe, it, expect } from 'vitest';
import { createTestDb } from '../db/client';
import { createVendor, setVendorBrandPrice } from './vendors';
import { createBrand } from './catalog';
import { eq } from 'drizzle-orm';
import { orders, users } from '../db/schema';
import {
  canTransition,
  createOrder,
  getActiveOrderForVendor,
  getOrderPriceSnapshot,
  listActiveOrders,
  listFinishedOrders,
  setOrderStatus,
} from './orders';

async function setup() {
  const db = createTestDb();
  const [admin] = await db
    .insert(users)
    .values({ telegramId: 'a1', displayName: 'Admin', role: 'admin', firstSeenAt: new Date().toISOString() })
    .returning()
    .all();
  const vasya = await createVendor(db, 'Vasya');
  const petya = await createVendor(db, 'Petya');
  const brand = await createBrand(db, 'DarkSide');
  await setVendorBrandPrice(db, vasya.id, brand.id, 42);
  return { db, admin, vasya, petya, brand };
}

type TestDb = Awaited<ReturnType<typeof setup>>['db'];

function stampCreatedAt(db: TestDb, orderId: number, at: string) {
  return db.update(orders).set({ createdAt: at }).where(eq(orders.id, orderId)).run();
}

function stampStatusChangedAt(db: TestDb, orderId: number, at: string) {
  return db.update(orders).set({ statusChangedAt: at }).where(eq(orders.id, orderId)).run();
}

describe('order lifecycle', () => {
  it('freezes the vendor prices into the order when it opens', async () => {
    const { db, admin, vasya, brand } = await setup();
    const order = await createOrder(db, vasya.id, admin.id);

    await setVendorBrandPrice(db, vasya.id, brand.id, 99);

    expect(await getOrderPriceSnapshot(db, order.id, brand.id)).toBe(42);
  });

  it('allows only one active order per vendor', async () => {
    const { db, admin, vasya } = await setup();
    await createOrder(db, vasya.id, admin.id);

    await expect(createOrder(db, vasya.id, admin.id)).rejects.toThrow('already has an active order');
  });

  it('allows several active orders as long as the vendors differ', async () => {
    const { db, admin, vasya, petya } = await setup();
    await createOrder(db, vasya.id, admin.id);
    await createOrder(db, petya.id, admin.id);

    expect(await listActiveOrders(db)).toHaveLength(2);
  });

  it('frees the vendor once the order reaches a terminal status', async () => {
    const { db, admin, vasya } = await setup();
    const first = await createOrder(db, vasya.id, admin.id);
    await setOrderStatus(db, first.id, 'rejected');

    expect(await getActiveOrderForVendor(db, vasya.id)).toBeNull();
    const second = await createOrder(db, vasya.id, admin.id);
    expect(second.id).not.toBe(first.id);
  });

  it('moves between collecting and validation as many times as needed', async () => {
    const { db, admin, vasya } = await setup();
    const order = await createOrder(db, vasya.id, admin.id);

    await setOrderStatus(db, order.id, 'awaiting_validation');
    await setOrderStatus(db, order.id, 'ordering');
    const back = await setOrderStatus(db, order.id, 'awaiting_validation');

    expect(back.status).toBe('awaiting_validation');
  });

  it('refuses to reopen a finished order', async () => {
    const { db, admin, vasya } = await setup();
    const order = await createOrder(db, vasya.id, admin.id);
    await setOrderStatus(db, order.id, 'awaiting_validation');
    await setOrderStatus(db, order.id, 'done');

    await expect(setOrderStatus(db, order.id, 'ordering')).rejects.toThrow(
      'cannot move an order from done to ordering'
    );
    await expect(setOrderStatus(db, order.id, 'awaiting_validation')).rejects.toThrow();
  });

  it('cannot finish an order straight from collecting', async () => {
    const { db, admin, vasya } = await setup();
    const order = await createOrder(db, vasya.id, admin.id);

    await expect(setOrderStatus(db, order.id, 'done')).rejects.toThrow(
      'cannot move an order from ordering to done'
    );
  });

  it('lists finished and cancelled orders for the history', async () => {
    const { db, admin, vasya, petya } = await setup();
    const finished = await createOrder(db, vasya.id, admin.id);
    await setOrderStatus(db, finished.id, 'awaiting_validation');
    await setOrderStatus(db, finished.id, 'done');
    const cancelled = await createOrder(db, petya.id, admin.id);
    await setOrderStatus(db, cancelled.id, 'rejected');
    await createOrder(db, vasya.id, admin.id); // still collecting

    const ids = (await listFinishedOrders(db)).map((order) => order.id);
    expect(ids.sort()).toEqual([finished.id, cancelled.id].sort());
  });

  it('lists active orders newest first', async () => {
    const { db, admin, vasya, petya } = await setup();
    const older = await createOrder(db, vasya.id, admin.id);
    const newer = await createOrder(db, petya.id, admin.id);
    // Both were opened in the same millisecond; spread them apart by hand so the
    // test measures the ordering and not the clock.
    await stampCreatedAt(db, older.id, '2026-01-01T10:00:00.000Z');
    await stampCreatedAt(db, newer.id, '2026-01-02T10:00:00.000Z');

    const ids = (await listActiveOrders(db)).map((order) => order.id);
    expect(ids).toEqual([newer.id, older.id]);
  });

  it('lists finished orders by when they finished, latest first', async () => {
    const { db, admin, vasya, petya } = await setup();
    // Opened first, closed last — history has to follow the closing, not the opening.
    const openedFirst = await createOrder(db, vasya.id, admin.id);
    const openedSecond = await createOrder(db, petya.id, admin.id);
    await stampCreatedAt(db, openedFirst.id, '2026-01-01T10:00:00.000Z');
    await stampCreatedAt(db, openedSecond.id, '2026-01-02T10:00:00.000Z');
    await setOrderStatus(db, openedSecond.id, 'rejected');
    await setOrderStatus(db, openedFirst.id, 'rejected');
    await stampStatusChangedAt(db, openedSecond.id, '2026-01-03T10:00:00.000Z');
    await stampStatusChangedAt(db, openedFirst.id, '2026-01-04T10:00:00.000Z');

    const ids = (await listFinishedOrders(db)).map((order) => order.id);
    expect(ids).toEqual([openedFirst.id, openedSecond.id]);
  });

  it('describes the whole transition table', () => {
    expect(canTransition('ordering', 'awaiting_validation')).toBe(true);
    expect(canTransition('ordering', 'rejected')).toBe(true);
    expect(canTransition('ordering', 'done')).toBe(false);
    expect(canTransition('awaiting_validation', 'ordering')).toBe(true);
    expect(canTransition('awaiting_validation', 'done')).toBe(true);
    expect(canTransition('awaiting_validation', 'rejected')).toBe(true);
    expect(canTransition('done', 'ordering')).toBe(false);
    expect(canTransition('rejected', 'ordering')).toBe(false);
  });
});
