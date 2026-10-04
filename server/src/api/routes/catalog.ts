import type { FastifyInstance } from 'fastify';
import type { Db } from '../../db/client.js';
import { requireAdmin } from '../middleware/authenticate.js';
import { getWeights, createBrand, listBrands, listFlavorsByBrand, importFlavorList } from '../../domain/catalog.js';
import {
  createVendor,
  listVendors,
  archiveVendor,
  deleteVendor,
  renameVendor,
  setVendorBrandPrice,
  getVendorBrandPrices,
} from '../../domain/vendors.js';
import type { GeminiClient } from '../../gemini/client.js';
import { reviewDuplicates } from '../../gemini/duplicateReview.js';
import { mergeFlavors } from '../../domain/flavorMerge.js';
import { listVendorAssortment, setFlavorAvailability } from '../../domain/availability.js';

export function catalogRoutes(db: Db, geminiClient?: GeminiClient) {
  return async function routes(api: FastifyInstance) {
    api.addHook('preHandler', requireAdmin);

    api.get('/weights', async () => getWeights(db));

    api.get('/brands', async () => listBrands(db));

    api.post<{ Body: { name: string } }>('/brands', async (req, reply) => {
      const brand = await createBrand(db, req.body.name);
      reply.code(201).send(brand);
    });

    api.get<{ Params: { brandId: string } }>('/brands/:brandId/flavors', async (req) => {
      const list = await listFlavorsByBrand(db, Number(req.params.brandId));
      return list.sort((a, b) => a.name.localeCompare(b.name, 'ru'));
    });

    /** One flavour per line; adds what is new, reports what was already there. */
    api.post<{ Params: { brandId: string }; Body: { text: string } }>(
      '/brands/:brandId/flavors/import',
      async (req, reply) => {
        if (typeof req.body?.text !== 'string' || !req.body.text.trim()) {
          reply.code(400).send({ error: 'text with one flavour per line is required' });
          return;
        }
        return importFlavorList(db, Number(req.params.brandId), req.body.text);
      }
    );

    /** What cleaning up this brand's duplicates and typos would merge. Changes nothing. */
    api.post<{ Params: { brandId: string } }>('/brands/:brandId/flavors/duplicates', async (req, reply) => {
      const brand = (await listBrands(db)).find((b) => b.id === Number(req.params.brandId));
      if (!brand) {
        reply.code(404).send({ error: 'brand not found' });
        return;
      }
      return reviewDuplicates(db, geminiClient ?? { generateFromImage: async () => '' }, brand);
    });

    /** Applies the merges the admin confirmed from the preview. */
    api.post<{
      Params: { brandId: string };
      Body: { merges: { keepId: number; dropIds: number[] }[] };
    }>('/brands/:brandId/flavors/merge', async (req, reply) => {
      const merges = req.body?.merges;
      if (!Array.isArray(merges) || merges.length === 0) {
        reply.code(400).send({ error: 'merges are required' });
        return;
      }
      try {
        return await mergeFlavors(db, Number(req.params.brandId), merges);
      } catch (err) {
        reply.code(400).send({ error: err instanceof Error ? err.message : 'merge failed' });
      }
    });

    api.get<{ Querystring: { includeArchived?: string } }>('/vendors', async (req) => {
      return listVendors(db, { includeArchived: req.query.includeArchived === 'true' });
    });

    api.post<{ Body: { name: string } }>('/vendors', async (req, reply) => {
      const vendor = await createVendor(db, req.body.name);
      reply.code(201).send(vendor);
    });

    api.post<{ Params: { vendorId: string } }>('/vendors/:vendorId/archive', async (req, reply) => {
      await archiveVendor(db, Number(req.params.vendorId));
      reply.code(204).send();
    });

    api.patch<{ Params: { vendorId: string }; Body: { name: string } }>(
      '/vendors/:vendorId',
      async (req) => renameVendor(db, Number(req.params.vendorId), req.body.name)
    );

    /**
     * Deletes the vendor if nobody ever ordered from it, archives it otherwise —
     * the response says which happened, so the UI can tell the truth.
     */
    api.delete<{ Params: { vendorId: string } }>('/vendors/:vendorId', async (req) => {
      const outcome = await deleteVendor(db, Number(req.params.vendorId));
      return { outcome };
    });

    /** Spec §4: the admin can look at the vendor's stock and correct it by hand. */
    api.get<{ Params: { vendorId: string } }>('/vendors/:vendorId/availability', async (req) => {
      return listVendorAssortment(db, Number(req.params.vendorId));
    });

    api.put<{
      Params: { vendorId: string };
      Body: {
        brandId: number;
        weightId: number;
        available: boolean;
        flavorId?: number;
        flavorName?: string;
      };
    }>('/vendors/:vendorId/availability', async (req, reply) => {
      const { brandId, weightId, available, flavorId, flavorName } = req.body;
      if (!brandId || !weightId) {
        reply.code(400).send({ error: 'brandId and weightId are required' });
        return;
      }
      return setFlavorAvailability(db, {
        vendorId: Number(req.params.vendorId),
        brandId,
        weightId,
        available,
        flavorId,
        flavorName,
      });
    });

    api.get<{ Params: { vendorId: string } }>('/vendors/:vendorId/prices', async (req) => {
      return getVendorBrandPrices(db, Number(req.params.vendorId));
    });

    api.put<{ Params: { vendorId: string; brandId: string }; Body: { pricePerKgEur: number } }>(
      '/vendors/:vendorId/prices/:brandId',
      async (req) => {
        return setVendorBrandPrice(
          db,
          Number(req.params.vendorId),
          Number(req.params.brandId),
          req.body.pricePerKgEur
        );
      }
    );
  };
}
