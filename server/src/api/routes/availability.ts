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
import { normalizeAvailabilityData, parseAvailabilityImage, type ParsedAvailability } from '../../gemini/availabilityParser.js';
import type { GeminiClient } from '../../gemini/client.js';

export function availabilityRoutes(db: Db, geminiClient: GeminiClient, uploadsDir: string) {
  type SessionNames = { brandId: number; names: string[] }[];

  async function resolveParsed(parsed: ParsedAvailability, sessionNames: SessionNames) {
    const brand = parsed.brand ? await matchBrandByName(db, parsed.brand) : null;
    // Both image and manual JSON use the same catalogue, sibling and duplicate checks.
    const known = brand ? (await listFlavorsByBrand(db, brand.id)).map((flavor) => flavor.name) : [];
    if (brand && Array.isArray(sessionNames)) {
      for (const sibling of sessionNames) {
        if (sibling?.brandId !== brand.id || !Array.isArray(sibling.names)) continue;
        for (const name of sibling.names) {
          if (typeof name === 'string' && !known.includes(name)) known.push(name);
        }
      }
    }
    const resolved = resolveEntries(parsed.flavors, known);
    const entries = brand
      ? await judgeDoubtfulEntries(geminiClient, brand.name, resolved)
      : resolved.map(({ checkWith: _flag, ...entry }) => entry);
    const weightRow = parsed.grams
      ? ((await db.select().from(weights).all()).find((row) => row.grams === parsed.grams) ?? null)
      : null;
    return {
      detectedBrandName: parsed.brand,
      brandId: brand?.id ?? null,
      detectedGrams: parsed.grams,
      weightId: weightRow?.id ?? null,
      entries,
    };
  }

  return async function routes(api: FastifyInstance) {
    api.addHook('preHandler', requireAdmin);

    /**
     * Reads one screenshot and reports what it says. Brand and weight are
     * suggestions: the admin confirms or corrects them on the review screen
     * before anything is written (spec §4).
     */
    api.post('/parse', async (req, reply) => {
      let vendorId: number | undefined;
      let sessionNames: { brandId: number; names: string[] }[] = [];
      let fileBuffer: Buffer | undefined;
      let mimeType = 'image/jpeg';

      for await (const part of req.parts()) {
        if (part.type === 'file' && part.fieldname === 'image') {
          fileBuffer = await part.toBuffer();
          mimeType = part.mimetype;
        } else if (part.type === 'field' && part.fieldname === 'vendorId') {
          vendorId = Number(part.value);
        } else if (part.type === 'field' && part.fieldname === 'sessionNames') {
          try {
            const parsedNames: unknown = JSON.parse(String(part.value));
            if (Array.isArray(parsedNames)) sessionNames = parsedNames;
          } catch {
            // A malformed hint only costs the cross-screenshot check, not the parse.
          }
        }
      }

      if (!fileBuffer || !vendorId) {
        reply.code(400).send({ error: 'missing image or vendorId field' });
        return;
      }

      const parsed = await parseAvailabilityImage(geminiClient, {
        imageBase64: fileBuffer.toString('base64'),
        mimeType,
        onInvalidResponse: (raw) => {
          const trimmed = raw.trim();
          const responseShape = !trimmed ? 'empty' : trimmed.startsWith('```') ? 'fenced'
            : trimmed.startsWith('{') ? 'object-like' : trimmed.startsWith('[') ? 'array-like'
            : trimmed.startsWith('"') ? 'quoted' : 'text';
          req.log.warn({ responseShape, responseLength: raw.length, endsWithBrace: trimmed.endsWith('}') },
            'availability model response was not JSON');
        },
      });

      const review = await resolveParsed(parsed, sessionNames);

      await fs.mkdir(uploadsDir, { recursive: true });
      const imageRef = path.join(uploadsDir, `${crypto.randomUUID()}.jpg`);
      await fs.writeFile(imageRef, fileBuffer);

      await db
        .insert(availabilityUploads)
        .values({
          vendorId,
          // Kept for audit: what the screenshot claimed, before the admin corrected it.
          brandId: review.brandId,
          weightId: review.weightId,
          imageRef,
          rawAiResponse: JSON.stringify(parsed),
          createdAt: new Date().toISOString(),
        })
        .run();

      return review;
    });

    api.post<{ Body: { vendorId: number; data: unknown; sessionNames?: SessionNames } }>(
      '/import-json', async (req, reply) => {
        const { vendorId, data, sessionNames = [] } = req.body ?? {};
        if (!Number.isInteger(vendorId) || vendorId <= 0) {
          reply.code(400).send({ error: 'vendorId is required' });
          return;
        }
        if (!data || typeof data !== 'object' || Array.isArray(data) ||
            !Object.hasOwn(data, 'brand') || !Object.hasOwn(data, 'grams') || !Object.hasOwn(data, 'flavors')) {
          reply.code(400).send({ error: 'brand, grams and flavors are required' });
          return;
        }
        const grams = (data as { grams: unknown }).grams;
        if (grams !== null && (!Number.isInteger(grams) || (grams as number) <= 0)) {
          reply.code(400).send({ error: 'grams must be a positive integer or null' });
          return;
        }
        let parsed: ParsedAvailability;
        try {
          parsed = normalizeAvailabilityData(data);
        } catch (err) {
          reply.code(400).send({ error: err instanceof Error ? err.message : 'invalid availability JSON' });
          return;
        }
        if (parsed.flavors.length === 0) {
          reply.code(400).send({ error: 'flavors must contain at least one name' });
          return;
        }
        return resolveParsed(parsed, sessionNames);
      }
    );

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
