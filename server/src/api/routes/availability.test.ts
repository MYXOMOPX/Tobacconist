import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Fastify from 'fastify';
import multipart from '@fastify/multipart';
import FormData from 'form-data';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { eq } from 'drizzle-orm';
import { createTestDb } from '../../db/client';
import { createVendor } from '../../domain/vendors';
import { createBrand, getWeights } from '../../domain/catalog';
import { listVendorAssortment, replaceAvailability } from '../../domain/availability';
import { availabilityRoutes } from './availability';
import { availabilityUploads } from '../../db/schema';
import type { AuthedUser } from '../middleware/authenticate';
import type { GeminiClient } from '../../gemini/client';

const admin: AuthedUser = { id: 1, telegramId: '1', displayName: 'Admin', role: 'admin' };
const member: AuthedUser = { id: 2, telegramId: '2', displayName: 'Friend', role: 'member' };

let uploadsDir: string;

beforeEach(async () => {
  uploadsDir = await fs.mkdtemp(path.join(os.tmpdir(), 'tobacconist-uploads-'));
});

afterEach(async () => {
  await fs.rm(uploadsDir, { recursive: true, force: true });
});

function testApp(user: AuthedUser, geminiResponse: string) {
  const db = createTestDb();
  const geminiClient: GeminiClient = { generateFromImage: async () => geminiResponse };
  const app = Fastify();
  app.register(multipart);
  app.addHook('preHandler', async (req) => {
    req.authedUser = user;
  });
  app.register(availabilityRoutes(db, geminiClient, uploadsDir), { prefix: '/api/admin/availability' });
  return { app, db };
}

function screenshot(vendorId: number) {
  const form = new FormData();
  form.append('vendorId', String(vendorId));
  form.append('image', Buffer.from('fake-bytes'), { filename: 'photo.jpg', contentType: 'image/jpeg' });
  return form;
}

const DARKSIDE_250 = JSON.stringify({
  brand: 'DARKSIDE CORE',
  grams: 250,
  flavors: [
    { name: 'CyberKiwi', available: true },
    { name: 'Mango', available: false },
  ],
});

describe('POST /parse', () => {
  it('resolves the brand and the weight the screenshot showed', async () => {
    const { app, db } = testApp(admin, DARKSIDE_250);
    const vendor = await createVendor(db, 'Vasya');
    const brand = await createBrand(db, 'DarkSide');
    const w250 = (await getWeights(db)).find((w) => w.grams === 250)!;

    const form = screenshot(vendor.id);
    const res = await app.inject({
      method: 'POST',
      url: '/api/admin/availability/parse',
      payload: form,
      headers: form.getHeaders(),
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      // The heading said "DARKSIDE CORE"; the catalogue calls it DarkSide.
      detectedBrandName: 'DARKSIDE CORE',
      brandId: brand.id,
      detectedGrams: 250,
      weightId: w250.id,
      entries: [
        { name: 'CyberKiwi', available: true },
        { name: 'Mango', available: false },
      ],
    });
    expect(await fs.readdir(uploadsDir)).toHaveLength(1);
  });

  it('reports an unknown brand as unresolved instead of inventing one', async () => {
    const { app, db } = testApp(
      admin,
      JSON.stringify({ brand: 'Chabacco', grams: 250, flavors: [{ name: 'Lemon Pie', available: true }] })
    );
    const vendor = await createVendor(db, 'Vasya');
    await createBrand(db, 'DarkSide');

    const form = screenshot(vendor.id);
    const res = await app.inject({
      method: 'POST',
      url: '/api/admin/availability/parse',
      payload: form,
      headers: form.getHeaders(),
    });

    expect(res.json()).toMatchObject({ detectedBrandName: 'Chabacco', brandId: null });
  });

  it('accepts a screenshot with no weight on it', async () => {
    const { app, db } = testApp(
      admin,
      JSON.stringify({ brand: 'DarkSide', grams: null, flavors: [{ name: 'Needls', available: true }] })
    );
    const vendor = await createVendor(db, 'Vasya');
    await createBrand(db, 'DarkSide');

    const form = screenshot(vendor.id);
    const res = await app.inject({
      method: 'POST',
      url: '/api/admin/availability/parse',
      payload: form,
      headers: form.getHeaders(),
    });

    expect(res.json()).toMatchObject({ detectedGrams: null, weightId: null });
  });

  it('needs the vendor, since that is the one thing a photo cannot tell', async () => {
    const { app } = testApp(admin, DARKSIDE_250);
    const form = new FormData();
    form.append('image', Buffer.from('bytes'), { filename: 'p.jpg', contentType: 'image/jpeg' });

    const res = await app.inject({
      method: 'POST',
      url: '/api/admin/availability/parse',
      payload: form,
      headers: form.getHeaders(),
    });

    expect(res.statusCode).toBe(400);
  });

  it('saves nothing to disk or database when parsing fails', async () => {
    const { app, db } = testApp(admin, 'not valid json at all');
    const vendor = await createVendor(db, 'Vasya');

    const form = screenshot(vendor.id);
    const res = await app.inject({
      method: 'POST',
      url: '/api/admin/availability/parse',
      payload: form,
      headers: form.getHeaders(),
    });

    expect(res.statusCode).not.toBe(200);
    expect(await fs.readdir(uploadsDir)).toHaveLength(0);
    const records = await db
      .select()
      .from(availabilityUploads)
      .where(eq(availabilityUploads.vendorId, vendor.id))
      .all();
    expect(records).toHaveLength(0);
  });
});

describe('POST /confirm', () => {
  it('saves several screenshots as one batch', async () => {
    const { app, db } = testApp(admin, '{}');
    const vendor = await createVendor(db, 'Vasya');
    const dark = await createBrand(db, 'DarkSide');
    const must = await createBrand(db, 'MustHave');
    const w250 = (await getWeights(db)).find((w) => w.grams === 250)!;

    const res = await app.inject({
      method: 'POST',
      url: '/api/admin/availability/confirm',
      payload: {
        vendorId: vendor.id,
        groups: [
          { brandId: dark.id, weightId: w250.id, entries: [{ name: 'CyberKiwi', available: true }] },
          { brandId: must.id, weightId: w250.id, entries: [{ name: 'Kiwi Smoothie', available: true }] },
        ],
      },
    });

    expect(res.statusCode).toBe(200);
    const stock = await listVendorAssortment(db, vendor.id, { onlyAvailable: true });
    expect(stock.map((row) => row.flavorName).sort()).toEqual(['CyberKiwi', 'Kiwi Smoothie']);
  });

  it('wipes the rest of the vendor stock when asked to', async () => {
    const { app, db } = testApp(admin, '{}');
    const vendor = await createVendor(db, 'Vasya');
    const dark = await createBrand(db, 'DarkSide');
    const must = await createBrand(db, 'MustHave');
    const w250 = (await getWeights(db)).find((w) => w.grams === 250)!;
    await replaceAvailability(db, {
      vendorId: vendor.id,
      brandId: must.id,
      weightId: w250.id,
      entries: [{ name: 'Kiwi Smoothie', available: true }],
    });

    await app.inject({
      method: 'POST',
      url: '/api/admin/availability/confirm',
      payload: {
        vendorId: vendor.id,
        groups: [{ brandId: dark.id, weightId: w250.id, entries: [{ name: 'CyberKiwi', available: true }] }],
        wipeOthers: true,
      },
    });

    const stock = await listVendorAssortment(db, vendor.id, { onlyAvailable: true });
    expect(stock.map((row) => row.flavorName)).toEqual(['CyberKiwi']);
  });

  it('refuses a group with no brand or weight resolved', async () => {
    const { app, db } = testApp(admin, '{}');
    const vendor = await createVendor(db, 'Vasya');

    const res = await app.inject({
      method: 'POST',
      url: '/api/admin/availability/confirm',
      payload: { vendorId: vendor.id, groups: [{ brandId: null, weightId: null, entries: [] }] },
    });

    expect(res.statusCode).toBe(400);
    expect(res.json().error).toContain('brand and a weight');
  });

  it('rejects a non-admin user with 403', async () => {
    const { app } = testApp(member, '{}');
    const res = await app.inject({
      method: 'POST',
      url: '/api/admin/availability/confirm',
      payload: { vendorId: 1, groups: [] },
    });
    expect(res.statusCode).toBe(403);
  });
});
