// server/src/api/routes/checklist.test.ts
import { describe, it, expect } from 'vitest';
import Fastify from 'fastify';
import { createTestDb, schema } from '../../db/client';
import { createVendor, setVendorBrandPrice } from '../../domain/vendors';
import { createBrand, getWeights } from '../../domain/catalog';
import { replaceAvailability } from '../../domain/availability';
import { openRound } from '../../domain/rounds';
import { upsertOrderItem } from '../../domain/orders';
import { generateOrUpdateChecklist } from '../../domain/checklist';
import { checklistRoutes } from './checklist';
import type { AuthedUser } from '../middleware/authenticate';

const admin: AuthedUser = { id: 1, telegramId: '1', displayName: 'Admin', role: 'admin' };
const member: AuthedUser = { id: 2, telegramId: '2', displayName: 'Member', role: 'member' };

function testApp(user: AuthedUser, db: ReturnType<typeof createTestDb>) {
  const app = Fastify();
  app.addHook('preHandler', async (req) => {
    req.authedUser = user;
  });
  app.register(checklistRoutes(db), { prefix: '/api/rounds/:roundId/checklist' });
  return app;
}

async function seedClosedRoundChecklist() {
  const db = createTestDb();
  // Create users for foreign key constraints
  await db
    .insert(schema.users)
    .values([
      { telegramId: '1', displayName: 'Admin', role: 'admin', firstSeenAt: new Date().toISOString() },
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
  const round = await openRound(db, vendor.id, admin.id);
  await upsertOrderItem(db, { roundId: round.id, userId: admin.id, brandId: brand.id, flavorId, weightId: w250.id, quantity: 5 });
  await generateOrUpdateChecklist(db, round.id);
  return { db, round };
}

describe('checklist routes', () => {
  it('GET / returns checklist rows with resolved names', async () => {
    const { db, round } = await seedClosedRoundChecklist();
    const app = testApp(admin, db);
    const res = await app.inject({ method: 'GET', url: `/api/rounds/${round.id}/checklist` });
    expect(res.json()).toEqual([
      expect.objectContaining({ brandName: 'DarkSide', flavorName: 'CyberKiwi', grams: 250, expectedQty: 5, receivedQty: 0 }),
    ]);
  });

  it('POST /:itemId/adjust bumps receivedQty by delta', async () => {
    const { db, round } = await seedClosedRoundChecklist();
    const app = testApp(admin, db);
    const list = await app.inject({ method: 'GET', url: `/api/rounds/${round.id}/checklist` });
    const itemId = list.json()[0].id;
    const res = await app.inject({
      method: 'POST',
      url: `/api/rounds/${round.id}/checklist/${itemId}/adjust`,
      payload: { delta: 2 },
    });
    expect(res.json().receivedQty).toBe(2);
  });

  it('rejects GET / as a non-admin with 403', async () => {
    const { db, round } = await seedClosedRoundChecklist();
    const app = testApp(member, db);
    const res = await app.inject({ method: 'GET', url: `/api/rounds/${round.id}/checklist` });
    expect(res.statusCode).toBe(403);
  });
});
