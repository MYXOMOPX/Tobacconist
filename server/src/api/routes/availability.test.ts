import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Fastify from 'fastify';
import multipart from '@fastify/multipart';
import FormData from 'form-data';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Writable } from 'node:stream';
import { eq } from 'drizzle-orm';
import { createTestDb } from '../../db/client';
import { createVendor } from '../../domain/vendors';
import { createBrand, getWeights, findOrCreateFlavor } from '../../domain/catalog';
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

function testApp(user: AuthedUser, geminiResponse: string, logLines?: string[]) {
  const db = createTestDb();
  const geminiClient: GeminiClient = { generateFromImage: async () => geminiResponse };
  const stream = logLines && new Writable({
    write(chunk, _encoding, done) {
      logLines.push(String(chunk));
      done();
    },
  });
  const app = Fastify(stream ? { logger: { stream } } : {});
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

  it('resolves a 120g screenshot to the new weight', async () => {
    const { app, db } = testApp(admin, JSON.stringify({
      brand: 'DarkSide', grams: 120, flavors: [{ name: 'Mango', available: true }],
    }));
    const vendor = await createVendor(db, 'Vasya');
    await createBrand(db, 'DarkSide');
    const w120 = (await getWeights(db)).find((weight) => weight.grams === 120)!;
    const form = screenshot(vendor.id);
    const res = await app.inject({
      method: 'POST', url: '/api/admin/availability/parse', payload: form, headers: form.getHeaders(),
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ detectedGrams: 120, weightId: w120.id });
  });

  it('snaps misread flavours to the known list and merges repeats', async () => {
    const { app, db } = testApp(
      admin,
      JSON.stringify({
        brand: 'DarkSide',
        grams: 250,
        flavors: [
          { name: 'CyberKiwl', available: true },
          { name: 'Mango', available: true },
          { name: 'MANGO', available: false },
        ],
      })
    );
    const vendor = await createVendor(db, 'Vasya');
    const brand = await createBrand(db, 'DarkSide');
    await findOrCreateFlavor(db, brand.id, 'CyberKiwi');

    const form = screenshot(vendor.id);
    const res = await app.inject({
      method: 'POST',
      url: '/api/admin/availability/parse',
      payload: form,
      headers: form.getHeaders(),
    });

    expect(res.json().entries).toEqual([
      { name: 'CyberKiwi', available: true, originalName: 'CyberKiwl' },
      { name: 'Mango', available: true },
    ]);
  });

  it('checks names against the other screenshots of the same brand only', async () => {
    const { app, db } = testApp(
      admin,
      JSON.stringify({
        brand: 'DarkSide',
        grams: 100,
        flavors: [{ name: 'Fruity Dast', available: true }],
      })
    );
    const vendor = await createVendor(db, 'Vasya');
    const dark = await createBrand(db, 'DarkSide');
    const form = screenshot(vendor.id);
    form.append(
      'sessionNames',
      JSON.stringify([
        { brandId: dark.id, names: ['Fruity Dust'] },
        { brandId: dark.id + 99, names: ['Fruity Dast'] },
      ])
    );
    const res = await app.inject({
      method: 'POST',
      url: '/api/admin/availability/parse',
      payload: form,
      headers: form.getHeaders(),
    });
    expect(res.json().entries).toEqual([{ name: 'Fruity Dust', available: true, originalName: 'Fruity Dast' }]);
  });

  it('leaves another brand alone: a similar name there is a different flavour', async () => {
    const { app, db } = testApp(
      admin,
      JSON.stringify({ brand: 'Blackburn', grams: 100, flavors: [{ name: 'Fruily Dast', available: true }] })
    );
    const vendor = await createVendor(db, 'Vasya');
    const dark = await createBrand(db, 'DarkSide');
    await createBrand(db, 'Blackburn');
    await findOrCreateFlavor(db, dark.id, 'Fruity Dust');
    const form = screenshot(vendor.id);
    const res = await app.inject({
      method: 'POST',
      url: '/api/admin/availability/parse',
      payload: form,
      headers: form.getHeaders(),
    });
    expect(res.json().entries).toEqual([{ name: 'Fruily Dast', available: true }]);
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

  it('logs the failed response shape without logging screenshot text', async () => {
    const lines: string[] = [];
    const { app, db } = testApp(admin, 'Private Vendor Stock List', lines);
    const vendor = await createVendor(db, 'Vasya');
    const form = screenshot(vendor.id);
    await app.inject({
      method: 'POST', url: '/api/admin/availability/parse', payload: form, headers: form.getHeaders(),
    });
    expect(lines.join('')).toContain('responseLength');
    expect(lines.join('')).not.toContain('Private Vendor Stock List');
  });
});

describe('POST /import-json', () => {
  it('validates and deduplicates pasted stock through the screenshot review pipeline', async () => {
    const { app, db } = testApp(admin, '{}');
    const vendor = await createVendor(db, 'Vasya');
    const brand = await createBrand(db, 'DarkSide');
    await findOrCreateFlavor(db, brand.id, 'CyberKiwi');
    const w250 = (await getWeights(db)).find((w) => w.grams === 250)!;

    const res = await app.inject({
      method: 'POST', url: '/api/admin/availability/import-json',
      payload: { vendorId: vendor.id, data: {
        brand: 'DarkSide', grams: 250,
        flavors: [
          { name: 'CyberKiwl', available: false },
          { name: 'CyberKiwi', available: true },
          { name: 'Mango', available: false },
          { name: 'MANGO', available: true },
        ],
      } },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      detectedBrandName: 'DarkSide', brandId: brand.id, detectedGrams: 250, weightId: w250.id,
      entries: [
        { name: 'CyberKiwi', available: true, originalName: 'CyberKiwl' },
        { name: 'Mango', available: true },
      ],
    });
    expect(await fs.readdir(uploadsDir)).toHaveLength(0);
  });

  it('rejects malformed pasted stock before it reaches review', async () => {
    const { app, db } = testApp(admin, '{}');
    const vendor = await createVendor(db, 'Vasya');
    const res = await app.inject({
      method: 'POST', url: '/api/admin/availability/import-json',
      payload: { vendorId: vendor.id, data: { brand: 'DarkSide', grams: 250, flavors: [{ name: 'Mango', available: 'yes' }] } },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toContain('available');
    expect(res.json().error).not.toContain('Модель');
  });

  it('requires all schema fields in pasted stock', async () => {
    const { app, db } = testApp(admin, '{}');
    const vendor = await createVendor(db, 'Vasya');
    const res = await app.inject({
      method: 'POST', url: '/api/admin/availability/import-json',
      payload: { vendorId: vendor.id, data: { brand: 'DarkSide', flavors: [{ name: 'Mango', available: true }] } },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toContain('grams');
  });

  it('requires admin access', async () => {
    const { app } = testApp(member, '{}');
    const res = await app.inject({
      method: 'POST', url: '/api/admin/availability/import-json',
      payload: { vendorId: 1, data: { brand: 'DarkSide', grams: 250, flavors: [] } },
    });
    expect(res.statusCode).toBe(403);
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
