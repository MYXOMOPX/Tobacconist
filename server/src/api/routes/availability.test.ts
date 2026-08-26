import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Fastify from 'fastify';
import multipart from '@fastify/multipart';
import FormData from 'form-data';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createTestDb } from '../../db/client';
import { createVendor } from '../../domain/vendors';
import { createBrand, getWeights } from '../../domain/catalog';
import { availabilityRoutes } from './availability';
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

describe('availability routes', () => {
  it('POST /parse returns proposed entries and records an audit upload row', async () => {
    const { app, db } = testApp(
      admin,
      JSON.stringify([{ name: 'CyberKiwi', available: true }, { name: 'Mango', available: false }])
    );
    const vendor = await createVendor(db, 'Vasya');
    const brand = await createBrand(db, 'DarkSide');
    const w250 = (await getWeights(db)).find((w) => w.grams === 250)!;

    const form = new FormData();
    form.append('vendorId', String(vendor.id));
    form.append('brandId', String(brand.id));
    form.append('weightId', String(w250.id));
    form.append('image', Buffer.from('fake-bytes'), { filename: 'photo.jpg', contentType: 'image/jpeg' });

    const res = await app.inject({
      method: 'POST',
      url: '/api/admin/availability/parse',
      payload: form,
      headers: form.getHeaders(),
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      entries: [
        { name: 'CyberKiwi', available: true },
        { name: 'Mango', available: false },
      ],
    });
    const savedFiles = await fs.readdir(uploadsDir);
    expect(savedFiles).toHaveLength(1);
  });

  it('POST /confirm saves availability and returns entries with assigned flavor ids', async () => {
    const { app, db } = testApp(admin, '[]');
    const vendor = await createVendor(db, 'Vasya');
    const brand = await createBrand(db, 'DarkSide');
    const w250 = (await getWeights(db)).find((w) => w.grams === 250)!;

    const res = await app.inject({
      method: 'POST',
      url: '/api/admin/availability/confirm',
      payload: {
        vendorId: vendor.id,
        brandId: brand.id,
        weightId: w250.id,
        entries: [{ name: 'CyberKiwi', available: true }],
      },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual([{ flavorId: expect.any(Number), flavorName: 'CyberKiwi', available: true }]);
  });

  it('rejects a non-admin user with 403', async () => {
    const { app } = testApp(member, '[]');
    const res = await app.inject({
      method: 'POST',
      url: '/api/admin/availability/confirm',
      payload: { vendorId: 1, brandId: 1, weightId: 1, entries: [] },
    });
    expect(res.statusCode).toBe(403);
  });
});
