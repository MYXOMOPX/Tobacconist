import type { FastifyInstance } from 'fastify';
import type { Db } from '../../db/client.js';
import { getActiveRound } from '../../domain/rounds.js';
import { listVendorAssortment } from '../../domain/availability.js';
import { upsertOrderItem } from '../../domain/orders.js';
import { computeUserSummary } from '../../domain/summary.js';

export function ordersRoutes(db: Db) {
  return async function routes(api: FastifyInstance) {
    api.get('/assortment', async () => {
      const round = await getActiveRound(db);
      if (!round) return [];
      return listVendorAssortment(db, round.vendorId, { onlyAvailable: true });
    });

    api.get('/mine', async (req) => {
      const round = await getActiveRound(db);
      if (!round) return { round: null, items: [], totalKg: 0, totalEur: 0, hasUnavailableItems: false };
      const summary = await computeUserSummary(db, round.id, req.authedUser!.id);
      return { round: { id: round.id, vendorId: round.vendorId, status: round.status }, ...summary };
    });

    api.put<{ Body: { brandId: number; flavorId: number; weightId: number; quantity: number } }>(
      '/items',
      async (req, reply) => {
        const round = await getActiveRound(db);
        if (!round) {
          reply.code(400).send({ error: 'no active round' });
          return;
        }
        const item = await upsertOrderItem(db, {
          roundId: round.id,
          userId: req.authedUser!.id,
          brandId: req.body.brandId,
          flavorId: req.body.flavorId,
          weightId: req.body.weightId,
          quantity: req.body.quantity,
        });
        return { item };
      }
    );
  };
}
