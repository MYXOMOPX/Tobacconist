import { describe, it, expect } from 'vitest';
import Fastify from 'fastify';
import { createTestDb, schema } from '../../db/client';
import { createVendor, setVendorBrandPrice } from '../../domain/vendors';
import { createBrand, getWeights } from '../../domain/catalog';
import { replaceAvailability } from '../../domain/availability';
import { upsertOrderItem } from '../../domain/orders';
import { listChecklist } from '../../domain/checklist';
import { roundsRoutes } from './rounds';
import type { AuthedUser } from '../middleware/authenticate';

const admin: AuthedUser = { id: 1, telegramId: '1', displayName: 'Admin', role: 'admin' };
const member: AuthedUser = { id: 2, telegramId: '2', displayName: 'Friend', role: 'member' };

function testApp(user: AuthedUser, db: ReturnType<typeof createTestDb>) {
  const app = Fastify();
  app.addHook('preHandler', async (req) => {
    req.authedUser = user;
  });
  app.setErrorHandler((err, req, reply) => {
    reply.code(400).send({ error: (err as Error).message });
  });
  app.register(roundsRoutes(db), { prefix: '/api/rounds' });
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

describe('rounds routes', () => {
  it('GET /active returns null when no round is open', async () => {
    const db = createTestDb();
    const app = testApp(admin, db);
    const res = await app.inject({ method: 'GET', url: '/api/rounds/active' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toBeNull();
  });

  it('POST / opens a round (admin only) and GET /active reflects it', async () => {
    const db = createTestDb();
    const { vendor } = await seedVendorWithStock(db);
    const app = testApp(admin, db);
    const create = await app.inject({ method: 'POST', url: '/api/rounds', payload: { vendorId: vendor.id } });
    expect(create.statusCode).toBe(201);
    expect(create.json()).toMatchObject({ vendorId: vendor.id, vendorName: 'Vasya', status: 'open' });

    const active = await app.inject({ method: 'GET', url: '/api/rounds/active' });
    expect(active.json().status).toBe('open');
  });

  it('rejects opening a round as a non-admin with 403', async () => {
    const db = createTestDb();
    const { vendor } = await seedVendorWithStock(db);
    const app = testApp(member, db);
    const res = await app.inject({ method: 'POST', url: '/api/rounds', payload: { vendorId: vendor.id } });
    expect(res.statusCode).toBe(403);
  });

  it('maps a domain error (opening a second round) to HTTP 400', async () => {
    const db = createTestDb();
    const { vendor } = await seedVendorWithStock(db);
    const app = testApp(admin, db);
    await app.inject({ method: 'POST', url: '/api/rounds', payload: { vendorId: vendor.id } });
    const res = await app.inject({ method: 'POST', url: '/api/rounds', payload: { vendorId: vendor.id } });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toMatch(/already open/i);
  });

  it('POST /:roundId/close regenerates the checklist from current orders', async () => {
    const db = createTestDb();
    const { vendor, brand, w250, flavorId } = await seedVendorWithStock(db);
    const app = testApp(admin, db);
    const create = await app.inject({ method: 'POST', url: '/api/rounds', payload: { vendorId: vendor.id } });
    const roundId = create.json().id;
    await upsertOrderItem(db, { roundId, userId: admin.id, brandId: brand.id, flavorId, weightId: w250.id, quantity: 4 });

    const close = await app.inject({ method: 'POST', url: `/api/rounds/${roundId}/close` });
    expect(close.statusCode).toBe(200);
    expect(close.json().status).toBe('closed');

    const checklist = await listChecklist(db, roundId);
    expect(checklist).toEqual([expect.objectContaining({ expectedQty: 4, receivedQty: 0 })]);
  });
});
