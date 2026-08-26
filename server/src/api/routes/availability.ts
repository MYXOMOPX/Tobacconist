import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import type { Db } from '../../db/client';
import { availabilityUploads } from '../../db/schema';
import { requireAdmin } from '../middleware/authenticate';
import { replaceAvailability } from '../../domain/availability';
import { parseAvailabilityImage, type GeminiClient } from '../../gemini/availabilityParser';

type ParseFields = { vendorId?: number; brandId?: number; weightId?: number };

export function availabilityRoutes(db: Db, geminiClient: GeminiClient, uploadsDir: string) {
  return async function routes(api: FastifyInstance) {
    api.addHook('preHandler', requireAdmin);

    api.post('/parse', async (req, reply) => {
      const fields: ParseFields = {};
      let fileBuffer: Buffer | undefined;
      let mimeType = 'image/jpeg';

      for await (const part of req.parts()) {
        if (part.type === 'file' && part.fieldname === 'image') {
          fileBuffer = await part.toBuffer();
          mimeType = part.mimetype;
        } else if (part.fieldname === 'vendorId') {
          fields.vendorId = Number(part.value);
        } else if (part.fieldname === 'brandId') {
          fields.brandId = Number(part.value);
        } else if (part.fieldname === 'weightId') {
          fields.weightId = Number(part.value);
        }
      }

      if (!fileBuffer || !fields.vendorId || !fields.brandId || !fields.weightId) {
        reply.code(400).send({ error: 'missing image or vendorId/brandId/weightId fields' });
        return;
      }

      const entries = await parseAvailabilityImage(geminiClient, {
        imageBase64: fileBuffer.toString('base64'),
        mimeType,
      });

      await fs.mkdir(uploadsDir, { recursive: true });
      const imageRef = path.join(uploadsDir, `${crypto.randomUUID()}.jpg`);
      await fs.writeFile(imageRef, fileBuffer);

      await db
        .insert(availabilityUploads)
        .values({
          vendorId: fields.vendorId,
          brandId: fields.brandId,
          weightId: fields.weightId,
          imageRef,
          rawAiResponse: JSON.stringify(entries),
          createdAt: new Date().toISOString(),
        })
        .run();

      return { entries };
    });

    api.post<{
      Body: {
        vendorId: number;
        brandId: number;
        weightId: number;
        entries: { name: string; available: boolean }[];
      };
    }>('/confirm', async (req) => {
      return replaceAvailability(db, {
        vendorId: req.body.vendorId,
        brandId: req.body.brandId,
        weightId: req.body.weightId,
        entries: req.body.entries,
      });
    });
  };
}
