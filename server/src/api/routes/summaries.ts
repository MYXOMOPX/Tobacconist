import type { FastifyInstance } from 'fastify';
import { eq } from 'drizzle-orm';
import type { Db } from '../../db/client.js';
import { users } from '../../db/schema.js';
import { requireAdmin } from '../middleware/authenticate.js';
import { listOrderItems } from '../../domain/orderItems.js';
import { computeUserSummary } from '../../domain/summary.js';
import { getPaymentStatus, getReadiness } from '../../domain/participants.js';

/**
 * Per-participant totals for one order (spec §9: the admin needs to see who owes
 * how much). Participants are derived from who actually has order items in the
 * order — the same rule the payments listing uses — so someone who was never
 * marked either way still shows up.
 */
export function summariesRoutes(db: Db) {
  return async function routes(api: FastifyInstance) {
    api.addHook('preHandler', requireAdmin);

    api.get<{ Params: { orderId: string } }>('/', async (req) => {
      const orderId = Number(req.params.orderId);
      const items = await listOrderItems(db, orderId);
      const userIds = [...new Set(items.map((i) => i.userId))];
      const result = [];
      for (const userId of userIds) {
        const user = await db.select().from(users).where(eq(users.id, userId)).get();
        const summary = await computeUserSummary(db, orderId, userId);
        result.push({
          userId,
          displayName: user?.displayName ?? '',
          items: summary.items,
          totalKg: summary.totalKg,
          totalEur: summary.totalEur,
          paid: await getPaymentStatus(db, orderId, userId),
          ready: await getReadiness(db, orderId, userId),
        });
      }
      return result;
    });
  };
}
