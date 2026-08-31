import type { FastifyInstance } from 'fastify';
import { eq, and } from 'drizzle-orm';
import type { Db } from '../../db/client.js';
import { orderItems } from '../../db/schema.js';
import { getOrder, isActiveStatus, listFinishedOrders } from '../../domain/orders.js';
import { computeUserSummary } from '../../domain/summary.js';
import { getPaymentStatus } from '../../domain/participants.js';
import { toOrderDto } from './orders.js';

/** Spec §10: finished and cancelled orders, kept whole and read-only. */
export function historyRoutes(db: Db) {
  return async function routes(api: FastifyInstance) {
    api.get('/', async (req) => {
      const rows = await listFinishedOrders(db);
      const dtos = await Promise.all(rows.map((row) => toOrderDto(db, row)));
      if (req.authedUser!.role === 'admin') return dtos;
      const myItems = await db
        .select()
        .from(orderItems)
        .where(eq(orderItems.userId, req.authedUser!.id))
        .all();
      const myOrderIds = new Set(myItems.map((item) => item.orderId));
      return dtos.filter((dto) => myOrderIds.has(dto.id));
    });

    api.get<{ Params: { orderId: string } }>('/:orderId', async (req, reply) => {
      const orderId = Number(req.params.orderId);
      const order = await getOrder(db, orderId);
      if (!order || isActiveStatus(order.status)) {
        reply.code(404).send({ error: 'order not found' });
        return;
      }
      // A participant only sees an order they actually took part in.
      if (req.authedUser!.role !== 'admin') {
        const mine = await db
          .select()
          .from(orderItems)
          .where(and(eq(orderItems.orderId, orderId), eq(orderItems.userId, req.authedUser!.id)))
          .all();
        if (mine.length === 0) {
          reply.code(404).send({ error: 'order not found' });
          return;
        }
      }
      const summary = await computeUserSummary(db, orderId, req.authedUser!.id);
      const paid = await getPaymentStatus(db, orderId, req.authedUser!.id);
      return { order: await toOrderDto(db, order), ...summary, paid };
    });
  };
}
