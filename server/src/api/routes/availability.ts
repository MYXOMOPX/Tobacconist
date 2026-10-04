import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import type { Db } from '../../db/client.js';
import { availabilityUploads, weights } from '../../db/schema.js';
import { requireAdmin } from '../middleware/authenticate.js';
import { applyAvailabilityBatch, type AvailabilityGroup } from '../../domain/availability.js';
import { matchBrandByName, listFlavorsByBrand } from '../../domain/catalog.js';
import { resolveEntries } from '../../domain/flavorMatch.js';
import { judgeDoubtfulEntries } from '../../gemini/typoJudge.js';
import { parseAvailabilityImage } from '../../gemini/availabilityParser.js';
import type { GeminiClient } from '../../gemini/client.js';

export function availabilityRoutes(db: Db, geminiClient: GeminiClient, uploadsDir: string) {
  return async function routes(api: FastifyInstance) {
    api.addHook('preHandler', requireAdmin);

    /**
     * Reads one screenshot and reports what it says. Brand and weight are
     * suggestions: the admin confirms or corrects them on the review screen
     * before anything is written (spec §4).
     */
    api.post('/parse', async (req, reply) => {
      let vendorId: number | undefined;
      let fileBuffer: Buffer | undefined;
      let mimeType = 'image/jpeg';

      for await (const part of req.parts()) {
        if (part.type === 'file' && part.fieldname === 'image') {
          fileBuffer = await part.toBuffer();
          mimeType = part.mimetype;
        } else if (part.type === 'field' && part.fieldname === 'vendorId') {
          vendorId = Number(part.value);
        }
      }

      if (!fileBuffer || !vendorId) {
        reply.code(400).send({ error: 'missing image or vendorId field' });
        return;
      }

      const parsed = await parseAvailabilityImage(geminiClient, {
        imageBase64: fileBuffer.toString('base64'),
        mimeType,
      });

      const brand = parsed.brand ? await matchBrandByName(db, parsed.brand) : null;
      // Snap the read names to the brand's known spellings, merge the repeats,
      // then let the model settle whatever the distance rule was unsure about.
      const known = brand ? (await listFlavorsByBrand(db, brand.id)).map((flavor) => flavor.name) : [];
      const resolved = resolveEntries(parsed.flavors, known);
      const entries = brand
        ? await judgeDoubtfulEntries(geminiClient, brand.name, resolved)
        : resolved.map(({ checkWith: _flag, ...entry }) => entry);

      const weightRow = parsed.grams
        ? ((await db.select().from(weights).all()).find((row) => row.grams === parsed.grams) ?? null)
        : null;

      await fs.mkdir(uploadsDir, { recursive: true });
      const imageRef = path.join(uploadsDir, `${crypto.randomUUID()}.jpg`);
      await fs.writeFile(imageRef, fileBuffer);

      await db
        .insert(availabilityUploads)
        .values({
          vendorId,
          // Kept for audit: what the screenshot claimed, before the admin corrected it.
          brandId: brand?.id ?? null,
          weightId: weightRow?.id ?? null,
          imageRef,
          rawAiResponse: JSON.stringify(parsed),
          createdAt: new Date().toISOString(),
        })
        .run();

      return {
        detectedBrandName: parsed.brand,
        brandId: brand?.id ?? null,
        detectedGrams: parsed.grams,
        weightId: weightRow?.id ?? null,
        entries,
      };
    });

    api.post<{
      Body: { vendorId: number; groups: AvailabilityGroup[]; wipeOthers?: boolean };
    }>('/confirm', async (req, reply) => {
      const { vendorId, groups, wipeOthers } = req.body;
      if (!vendorId || !Array.isArray(groups) || groups.length === 0) {
        reply.code(400).send({ error: 'vendorId and at least one group are required' });
        return;
      }
      for (const group of groups) {
        if (!group.brandId || !group.weightId) {
          reply.code(400).send({ error: 'every group needs a brand and a weight' });
          return;
        }
      }
      return applyAvailabilityBatch(db, { vendorId, groups, wipeOthers });
    });
  };
}
