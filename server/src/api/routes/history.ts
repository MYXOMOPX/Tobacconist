import type { FastifyInstance } from 'fastify';
import { eq } from 'drizzle-orm';
import type { Db } from '../../db/client';
import { purchaseRounds, orderItems } from '../../db/schema';
import { getRound } from '../../domain/rounds';
import { computeUserSummary } from '../../domain/summary';
import { getPaymentStatus } from '../../domain/payments';
import { toRoundDto } from './rounds';

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

    api.get<{ Params: { roundId: string } }>('/:roundId', async (req) => {
      const roundId = Number(req.params.roundId);
      const round = await getRound(db, roundId);
      if (!round) throw new Error('round not found');
      const summary = await computeUserSummary(db, roundId, req.authedUser!.id);
      const paid = await getPaymentStatus(db, roundId, req.authedUser!.id);
      return { round: await toRoundDto(db, round), ...summary, paid };
    });
  };
}
