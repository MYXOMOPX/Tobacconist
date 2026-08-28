import type { FastifyInstance } from 'fastify';
import { eq, and } from 'drizzle-orm';
import type { Db } from '../../db/client.js';
import { purchaseRounds, orderItems } from '../../db/schema.js';
import { getRound } from '../../domain/rounds.js';
import { computeUserSummary } from '../../domain/summary.js';
import { getPaymentStatus } from '../../domain/payments.js';
import { toRoundDto } from './rounds.js';

export function historyRoutes(db: Db) {
  return async function routes(api: FastifyInstance) {
    api.get('/', async (req) => {
      const rows = await db.select().from(purchaseRounds).where(eq(purchaseRounds.status, 'closed')).all();
      const dtos = await Promise.all(rows.map((r) => toRoundDto(db, r)));
      if (req.authedUser!.role === 'admin') return dtos;
      const myItems = await db
        .select()
        .from(orderItems)
        .where(eq(orderItems.userId, req.authedUser!.id))
        .all();
      const myRoundIds = new Set(myItems.map((i) => i.roundId));
      return dtos.filter((d) => myRoundIds.has(d.id));
    });

    api.get<{ Params: { roundId: string } }>('/:roundId', async (req, reply) => {
      const roundId = Number(req.params.roundId);
      const round = await getRound(db, roundId);
      if (!round || round.status !== 'closed') {
        reply.code(404).send({ error: 'round not found' });
        return;
      }
      // For non-admins, check if they have at least one order item in this round
      if (req.authedUser!.role !== 'admin') {
        const userOrderItems = await db
          .select()
          .from(orderItems)
          .where(and(eq(orderItems.roundId, roundId), eq(orderItems.userId, req.authedUser!.id)))
          .all();
        if (userOrderItems.length === 0) {
          reply.code(404).send({ error: 'round not found' });
          return;
        }
      }
      const summary = await computeUserSummary(db, roundId, req.authedUser!.id);
      const paid = await getPaymentStatus(db, roundId, req.authedUser!.id);
      return { round: await toRoundDto(db, round), ...summary, paid };
    });
  };
}
