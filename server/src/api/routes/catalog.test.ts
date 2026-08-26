import { describe, it, expect } from 'vitest';
import Fastify from 'fastify';
import { createTestDb } from '../../db/client';
import { catalogRoutes } from './catalog';
import type { AuthedUser } from '../middleware/authenticate';

function testApp(user: AuthedUser) {
  const db = createTestDb();
  const app = Fastify();
  app.addHook('preHandler', async (req) => {
    req.authedUser = user;
  });
  app.register(catalogRoutes(db), { prefix: '/api/admin' });
  return { app, db };
}

const admin: AuthedUser = { id: 1, telegramId: '1', displayName: 'Admin', role: 'admin' };
const member: AuthedUser = { id: 2, telegramId: '2', displayName: 'Friend', role: 'member' };

describe('catalog routes', () => {
  it('GET /weights returns the fixed set', async () => {
    const { app } = testApp(admin);
    const res = await app.inject({ method: 'GET', url: '/api/admin/weights' });
    expect(res.statusCode).toBe(200);
    expect(res.json().map((w: any) => w.grams).sort()).toEqual([100, 250]);
  });

  it('POST /brands creates a brand, GET /brands lists it', async () => {
    const { app } = testApp(admin);
    const create = await app.inject({ method: 'POST', url: '/api/admin/brands', payload: { name: 'DarkSide' } });
    expect(create.statusCode).toBe(201);
    const list = await app.inject({ method: 'GET', url: '/api/admin/brands' });
    expect(list.json()).toEqual([{ id: 1, name: 'DarkSide' }]);
  });

  it('vendor + price flow: create vendor, set price, read it back', async () => {
    const { app } = testApp(admin);
    const vendorRes = await app.inject({ method: 'POST', url: '/api/admin/vendors', payload: { name: 'Vasya' } });
    const vendor = vendorRes.json();
    const brandRes = await app.inject({ method: 'POST', url: '/api/admin/brands', payload: { name: 'DarkSide' } });
    const brand = brandRes.json();
    await app.inject({
      method: 'PUT',
      url: `/api/admin/vendors/${vendor.id}/prices/${brand.id}`,
      payload: { pricePerKgEur: 20 },
    });
    const prices = await app.inject({ method: 'GET', url: `/api/admin/vendors/${vendor.id}/prices` });
    expect(prices.json()).toEqual([
      { vendorId: vendor.id, brandId: brand.id, brandName: 'DarkSide', pricePerKgEur: 20 },
    ]);
  });

  it('rejects a non-admin user with 403', async () => {
    const { app } = testApp(member);
    const res = await app.inject({ method: 'GET', url: '/api/admin/brands' });
    expect(res.statusCode).toBe(403);
  });
});
