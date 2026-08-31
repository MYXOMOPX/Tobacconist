import { describe, it, expect } from 'vitest';
import { createTestDb } from '../db/client';
import { createVendor, setVendorBrandPrice } from './vendors';
import { createBrand, getWeights } from './catalog';
import { replaceAvailability } from './availability';
import { createOrder, setOrderStatus } from './orders';
import { upsertOrderItem, listOrderItems } from './orderItems';
import { generateOrUpdateChecklist, listChecklist, adjustReceivedQty } from './checklist';
import { applyDelivery, clearDelivery, listDiscrepancies } from './distribution';
import { computeUserSummary } from './summary';
import { users } from '../db/schema';

/** Two friends order the same flavour, so a shortfall has to land on one of them. */
async function setup() {
  const db = createTestDb();
  const [admin] = await db
    .insert(users)
    .values({ telegramId: 'a1', displayName: 'Admin', role: 'admin', firstSeenAt: new Date().toISOString() })
    .returning()
    .all();
  const [friend] = await db
    .insert(users)
    .values({ telegramId: 'f1', displayName: 'Friend', role: 'member', firstSeenAt: new Date().toISOString() })
    .returning()
    .all();
  const vendor = await createVendor(db, 'Vasya');
  const brand = await createBrand(db, 'DarkSide');
  await setVendorBrandPrice(db, vendor.id, brand.id, 20); // 5 EUR per 250g pack
  const w250 = (await getWeights(db)).find((w) => w.grams === 250)!;
  const [{ flavorId }] = await replaceAvailability(db, {
    vendorId: vendor.id,
    brandId: brand.id,
    weightId: w250.id,
    entries: [{ name: 'CyberKiwi', available: true }],
  });
  const order = await createOrder(db, vendor.id, admin.id);

  async function order3and1() {
    await upsertOrderItem(db, { orderId: order.id, userId: friend.id, brandId: brand.id, flavorId, weightId: w250.id, quantity: 3 });
    await upsertOrderItem(db, { orderId: order.id, userId: admin.id, brandId: brand.id, flavorId, weightId: w250.id, quantity: 1 });
    await setOrderStatus(db, order.id, 'awaiting_validation');
    await generateOrUpdateChecklist(db, order.id);
  }

  return { db, admin, friend, vendor, brand, w250, flavorId, order, order3and1 };
}

describe('delivery distribution', () => {
  it('has nothing to decide when the delivery matched the order', async () => {
    const { db, order, order3and1 } = await setup();
    await order3and1();
    const [entry] = await listChecklist(db, order.id);
    await adjustReceivedQty(db, entry.id, 4);

    expect(await listDiscrepancies(db, order.id)).toEqual([]);
  });

  it('proposes a split proportional to what each person ordered, rounded down', async () => {
    const { db, order, admin, friend, order3and1 } = await setup();
    await order3and1();
    const [entry] = await listChecklist(db, order.id);
    await adjustReceivedQty(db, entry.id, 2); // 2 of 4 arrived

    const [group] = await listDiscrepancies(db, order.id);
    const forFriend = group.participants.find((p) => p.userId === friend.id)!;
    const forAdmin = group.participants.find((p) => p.userId === admin.id)!;

    // 3/4 of 2 = 1.5 → 1, and 1/4 of 2 = 0.5 → 0. The leftover pack is the
    // admin's call, which is why the numbers deliberately do not add up yet.
    expect(forFriend.proposedDeliveredQty).toBe(1);
    expect(forAdmin.proposedDeliveredQty).toBe(0);
  });

  it('settles matching lines automatically when nothing is in dispute', async () => {
    const { db, order, admin, friend, order3and1 } = await setup();
    await order3and1();
    const [entry] = await listChecklist(db, order.id);
    await adjustReceivedQty(db, entry.id, 4);

    await applyDelivery(db, order.id, []);

    const items = await listOrderItems(db, order.id);
    expect(items.find((item) => item.userId === friend.id)!.deliveredQty).toBe(3);
    expect(items.find((item) => item.userId === admin.id)!.deliveredQty).toBe(1);
  });

  it('refuses to settle while a shortfall is unassigned', async () => {
    const { db, order, order3and1 } = await setup();
    await order3and1();
    const [entry] = await listChecklist(db, order.id);
    await adjustReceivedQty(db, entry.id, 3);

    await expect(applyDelivery(db, order.id, [])).rejects.toThrow('must be distributed');
  });

  it('refuses a split that does not add up to what arrived', async () => {
    const { db, order, order3and1 } = await setup();
    await order3and1();
    const [entry] = await listChecklist(db, order.id);
    await adjustReceivedQty(db, entry.id, 3);
    const [group] = await listDiscrepancies(db, order.id);

    await expect(
      applyDelivery(
        db,
        order.id,
        group.participants.map((p) => ({ orderItemId: p.orderItemId, deliveredQty: 1 }))
      )
    ).rejects.toThrow('distributed 2 of 3 delivered packs');
  });

  it('charges each person for what they actually got', async () => {
    const { db, order, admin, friend, order3and1 } = await setup();
    await order3and1();
    const [entry] = await listChecklist(db, order.id);
    await adjustReceivedQty(db, entry.id, 3); // one pack short

    const [group] = await listDiscrepancies(db, order.id);
    const forFriend = group.participants.find((p) => p.userId === friend.id)!;
    const forAdmin = group.participants.find((p) => p.userId === admin.id)!;
    await applyDelivery(db, order.id, [
      { orderItemId: forFriend.orderItemId, deliveredQty: 2 },
      { orderItemId: forAdmin.orderItemId, deliveredQty: 1 },
    ]);

    // Friend ordered 3 packs at 5 EUR but got 2.
    expect((await computeUserSummary(db, order.id, friend.id)).totalEur).toBe(10);
    expect((await computeUserSummary(db, order.id, admin.id)).totalEur).toBe(5);
  });

  it('handles an over-delivery the same way — someone has to take the extra pack', async () => {
    const { db, order, friend, admin, order3and1 } = await setup();
    await order3and1();
    const [entry] = await listChecklist(db, order.id);
    await adjustReceivedQty(db, entry.id, 5); // one more than ordered

    const [group] = await listDiscrepancies(db, order.id);
    const forFriend = group.participants.find((p) => p.userId === friend.id)!;
    const forAdmin = group.participants.find((p) => p.userId === admin.id)!;
    await applyDelivery(db, order.id, [
      { orderItemId: forFriend.orderItemId, deliveredQty: 4 },
      { orderItemId: forAdmin.orderItemId, deliveredQty: 1 },
    ]);

    expect((await computeUserSummary(db, order.id, friend.id)).totalEur).toBe(20);
  });

  it('rejects an allocation that points at another order line', async () => {
    const { db, order, order3and1 } = await setup();
    await order3and1();
    const [entry] = await listChecklist(db, order.id);
    await adjustReceivedQty(db, entry.id, 3);

    await expect(applyDelivery(db, order.id, [{ orderItemId: 9999, deliveredQty: 3 }])).rejects.toThrow(
      'does not belong to this order'
    );
  });

  it('forgets the recorded delivery when the order goes back to collecting', async () => {
    const { db, order, order3and1 } = await setup();
    await order3and1();
    const [entry] = await listChecklist(db, order.id);
    await adjustReceivedQty(db, entry.id, 4);
    await applyDelivery(db, order.id, []);

    await clearDelivery(db, order.id);

    const items = await listOrderItems(db, order.id);
    expect(items.every((item) => item.deliveredQty === null)).toBe(true);
  });
});
