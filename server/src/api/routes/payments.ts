import type { FastifyInstance } from 'fastify';
import { eq } from 'drizzle-orm';
import type { Db } from '../../db/client';
import { users } from '../../db/schema';
import { requireAdmin } from '../middleware/authenticate';
import { listRoundOrderItems } from '../../domain/orders';
import { setPaymentStatus, getPaymentStatus } from '../../domain/payments';

export function paymentsRoutes(db: Db) {
  return async function routes(api: FastifyInstance) {
    api.addHook('preHandler', requireAdmin);

    api.get<{ Params: { roundId: string } }>('/', async (req) => {
      const roundId = Number(req.params.roundId);
      const items = await listRoundOrderItems(db, roundId);
      const userIds = [...new Set(items.map((i) => i.userId))];
      const result = [];
      for (const userId of userIds) {
        const user = await db.select().from(users).where(eq(users.id, userId)).get();
        const paid = await getPaymentStatus(db, roundId, userId);
        result.push({ userId, displayName: user?.displayName ?? '', paid });
      }
      return result;
    });

    api.post<{ Params: { roundId: string; userId: string }; Body: { paid: boolean } }>(
      '/:userId',
      async (req) => {
        const roundId = Number(req.params.roundId);
        const userId = Number(req.params.userId);
        return setPaymentStatus(db, roundId, userId, req.body.paid, req.authedUser!.id);
      }
    );
  };
}
