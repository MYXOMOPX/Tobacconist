import type { FastifyInstance } from 'fastify';
import type { Db } from '../../db/client';
import { requireAdmin } from '../middleware/authenticate';
import { getWeights, createBrand, listBrands } from '../../domain/catalog';
import {
  createVendor,
  listVendors,
  archiveVendor,
  setVendorBrandPrice,
  getVendorBrandPrices,
} from '../../domain/vendors';

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
