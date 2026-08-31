import { describe, it, expect } from 'vitest';
import Fastify from 'fastify';
import { createTestDb } from '../../db/client';
import { catalogRoutes } from './catalog';
import type { AuthedUser } from '../middleware/authenticate';
import { createVendor, listVendors } from '../../domain/vendors';
import { createBrand, getWeights } from '../../domain/catalog';
import { listVendorAssortment, replaceAvailability } from '../../domain/availability';

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

describe('vendor detail routes', () => {
  it('lists the vendor stock, in stock and out', async () => {
    const { app, db } = testApp(admin);
    const vendor = await createVendor(db, 'Vasya');
    const brand = await createBrand(db, 'DarkSide');
    const w250 = (await getWeights(db)).find((w) => w.grams === 250)!;
    await replaceAvailability(db, {
      vendorId: vendor.id,
      brandId: brand.id,
      weightId: w250.id,
      entries: [
        { name: 'Needls', available: true },
        { name: 'Desert Eagle', available: false },
      ],
    });

    const res = await app.inject({ method: 'GET', url: `/api/admin/vendors/${vendor.id}/availability` });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ flavorName: 'Needls', available: true }),
        expect.objectContaining({ flavorName: 'Desert Eagle', available: false }),
      ])
    );
  });

  it('creates a position by hand for a flavour nobody photographed', async () => {
    const { app, db } = testApp(admin);
    const vendor = await createVendor(db, 'Vasya');
    const brand = await createBrand(db, 'DarkSide');
    const w250 = (await getWeights(db)).find((w) => w.grams === 250)!;

    const res = await app.inject({
      method: 'PUT',
      url: `/api/admin/vendors/${vendor.id}/availability`,
      payload: { brandId: brand.id, weightId: w250.id, flavorName: 'Cosmo Pole', available: true },
    });

    expect(res.statusCode).toBe(200);
    const stock = await listVendorAssortment(db, vendor.id, { onlyAvailable: true });
    expect(stock.map((row) => row.flavorName)).toEqual(['Cosmo Pole']);
  });

  it('flips an existing position without touching the rest', async () => {
    const { app, db } = testApp(admin);
    const vendor = await createVendor(db, 'Vasya');
    const brand = await createBrand(db, 'DarkSide');
    const w250 = (await getWeights(db)).find((w) => w.grams === 250)!;
    const [needls] = await replaceAvailability(db, {
      vendorId: vendor.id,
      brandId: brand.id,
      weightId: w250.id,
      entries: [
        { name: 'Needls', available: true },
        { name: 'Ice Storm', available: true },
      ],
    });

    await app.inject({
      method: 'PUT',
      url: `/api/admin/vendors/${vendor.id}/availability`,
      payload: { brandId: brand.id, weightId: w250.id, flavorId: needls.flavorId, available: false },
    });

    const stock = await listVendorAssortment(db, vendor.id, { onlyAvailable: true });
    expect(stock.map((row) => row.flavorName)).toEqual(['Ice Storm']);
  });

  it('renames a vendor', async () => {
    const { app, db } = testApp(admin);
    const vendor = await createVendor(db, 'Vasya');

    const res = await app.inject({
      method: 'PATCH',
      url: `/api/admin/vendors/${vendor.id}`,
      payload: { name: 'Boss Shisha' },
    });

    expect(res.json()).toMatchObject({ name: 'Boss Shisha' });
  });

  it('deletes an unused vendor and reports that it is gone', async () => {
    const { app, db } = testApp(admin);
    const vendor = await createVendor(db, 'Vasya');

    const res = await app.inject({ method: 'DELETE', url: `/api/admin/vendors/${vendor.id}` });

    expect(res.json()).toEqual({ outcome: 'deleted' });
    expect(await listVendors(db, { includeArchived: true })).toEqual([]);
  });

  it('rejects a non-admin', async () => {
    const { app, db } = testApp(member);
    const vendor = await createVendor(db, 'Vasya');
    const res = await app.inject({ method: 'DELETE', url: `/api/admin/vendors/${vendor.id}` });
    expect(res.statusCode).toBe(403);
  });
});
