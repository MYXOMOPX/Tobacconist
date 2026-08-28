import type { FastifyInstance } from 'fastify';
import { eq } from 'drizzle-orm';
import type { Db } from '../../db/client.js';
import { users } from '../../db/schema.js';
import { requireAdmin } from '../middleware/authenticate.js';
import { listRoundOrderItems } from '../../domain/orders.js';
import { computeUserSummary } from '../../domain/summary.js';
import { getPaymentStatus } from '../../domain/payments.js';

/**
 * Per-participant totals for one round (spec §9: the admin needs to see who owes
 * how much). Participants are derived from who actually has order items in the
 * round — the same rule the payments listing uses — so someone who was never
 * marked either way still shows up.
 */
export function summariesRoutes(db: Db) {
  return async function routes(api: FastifyInstance) {
    api.addHook('preHandler', requireAdmin);

    api.get<{ Params: { roundId: string } }>('/', async (req) => {
      const roundId = Number(req.params.roundId);
      const items = await listRoundOrderItems(db, roundId);
      const userIds = [...new Set(items.map((i) => i.userId))];
      const result = [];
      for (const userId of userIds) {
        const user = await db.select().from(users).where(eq(users.id, userId)).get();
        const summary = await computeUserSummary(db, roundId, userId);
        const paid = await getPaymentStatus(db, roundId, userId);
        result.push({
          userId,
          displayName: user?.displayName ?? '',
          totalKg: summary.totalKg,
          totalEur: summary.totalEur,
          paid,
        });
      }
      return result;
    });
  };
}
