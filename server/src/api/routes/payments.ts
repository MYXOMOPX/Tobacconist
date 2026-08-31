import type { FastifyInstance } from 'fastify';
import { eq } from 'drizzle-orm';
import type { Db } from '../../db/client.js';
import { users } from '../../db/schema.js';
import { requireAdmin } from '../middleware/authenticate.js';
import { listOrderItems } from '../../domain/orderItems.js';
import { setPaymentStatus, getPaymentStatus } from '../../domain/participants.js';

export function paymentsRoutes(db: Db) {
  return async function routes(api: FastifyInstance) {
    api.addHook('preHandler', requireAdmin);

    api.get<{ Params: { orderId: string } }>('/', async (req) => {
      const orderId = Number(req.params.orderId);
      const items = await listOrderItems(db, orderId);
      const userIds = [...new Set(items.map((i) => i.userId))];
      const result = [];
      for (const userId of userIds) {
        const user = await db.select().from(users).where(eq(users.id, userId)).get();
        const paid = await getPaymentStatus(db, orderId, userId);
        result.push({ userId, displayName: user?.displayName ?? '', paid });
      }
      return result;
    });

    api.post<{ Params: { orderId: string; userId: string }; Body: { paid: boolean } }>(
      '/:userId',
      async (req) => {
        const orderId = Number(req.params.orderId);
        const userId = Number(req.params.userId);
        return setPaymentStatus(db, orderId, userId, req.body.paid, req.authedUser!.id);
      }
    );
  };
}
