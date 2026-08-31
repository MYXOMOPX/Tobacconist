import type { FastifyInstance } from 'fastify';
import type { Db } from '../../db/client.js';
import { requireAdmin } from '../middleware/authenticate.js';
import { computeAggregateSummary } from '../../domain/summary.js';
import { buildTextSnapshot, buildTableSnapshot } from '../../domain/snapshot.js';

export function snapshotRoutes(db: Db) {
  return async function routes(api: FastifyInstance) {
    api.addHook('preHandler', requireAdmin);

    api.get<{ Params: { orderId: string } }>('/', async (req) => {
      const { lines } = await computeAggregateSummary(db, Number(req.params.orderId));
      return { text: buildTextSnapshot(lines), table: buildTableSnapshot(lines) };
    });
  };
}
