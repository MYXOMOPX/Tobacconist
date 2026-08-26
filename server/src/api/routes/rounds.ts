import type { FastifyInstance } from 'fastify';
import { eq } from 'drizzle-orm';
import type { Db } from '../../db/client';
import { vendors } from '../../db/schema';
import { requireAdmin } from '../middleware/authenticate';
import { openRound, closeRound, reopenRound, getActiveRound, getRound, type Round } from '../../domain/rounds';
import { generateOrUpdateChecklist } from '../../domain/checklist';

export async function toRoundDto(db: Db, round: Round) {
  const vendor = await db.select().from(vendors).where(eq(vendors.id, round.vendorId)).get();
  return {
    id: round.id,
    vendorId: round.vendorId,
    vendorName: vendor?.name ?? '',
    status: round.status,
    openedAt: round.openedAt,
    closedAt: round.closedAt,
  };
}

export function roundsRoutes(db: Db) {
  return async function routes(api: FastifyInstance) {
    api.get('/active', async () => {
      const round = await getActiveRound(db);
      return round ? toRoundDto(db, round) : null;
    });

    api.get<{ Params: { roundId: string } }>('/:roundId', async (req, reply) => {
      const round = await getRound(db, Number(req.params.roundId));
      if (!round) {
        reply.code(404).send({ error: 'round not found' });
        return;
      }
      return toRoundDto(db, round);
    });

    api.post<{ Body: { vendorId: number } }>('/', { preHandler: requireAdmin }, async (req, reply) => {
      const round = await openRound(db, req.body.vendorId, req.authedUser!.id);
      reply.code(201).send(await toRoundDto(db, round));
    });

    api.post<{ Params: { roundId: string } }>(
      '/:roundId/close',
      { preHandler: requireAdmin },
      async (req) => {
        const roundId = Number(req.params.roundId);
        await closeRound(db, roundId);
        await generateOrUpdateChecklist(db, roundId);
        return toRoundDto(db, (await getRound(db, roundId))!);
      }
    );

    api.post<{ Params: { roundId: string } }>(
      '/:roundId/reopen',
      { preHandler: requireAdmin },
      async (req) => {
        const roundId = Number(req.params.roundId);
        await reopenRound(db, roundId);
        return toRoundDto(db, (await getRound(db, roundId))!);
      }
    );
  };
}
