import type { FastifyInstance } from 'fastify';
import type { Db } from '../../db/client.js';
import { requireAdmin } from '../middleware/authenticate.js';
import { getWeights, createBrand, listBrands } from '../../domain/catalog.js';
import {
  createVendor,
  listVendors,
  archiveVendor,
  deleteVendor,
  renameVendor,
  setVendorBrandPrice,
  getVendorBrandPrices,
} from '../../domain/vendors.js';
import { listVendorAssortment, setFlavorAvailability } from '../../domain/availability.js';

export function catalogRoutes(db: Db) {
  return async function routes(api: FastifyInstance) {
    api.addHook('preHandler', requireAdmin);

    api.get('/weights', async () => getWeights(db));

    api.get('/brands', async () => listBrands(db));

    api.post<{ Body: { name: string } }>('/brands', async (req, reply) => {
      const brand = await createBrand(db, req.body.name);
      reply.code(201).send(brand);
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
