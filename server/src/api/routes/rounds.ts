import type { FastifyInstance } from 'fastify';
import { eq } from 'drizzle-orm';
import { runInTransaction, type Db } from '../../db/client.js';
import { vendors } from '../../db/schema.js';
import { requireAdmin } from '../middleware/authenticate.js';
import { openRound, closeRound, reopenRound, getActiveRound, getRound, type Round } from '../../domain/rounds.js';
import { generateOrUpdateChecklist } from '../../domain/checklist.js';
import type { RoundAnnouncer } from '../../telegram/notify.js';

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

export function roundsRoutes(db: Db, roundAnnouncer: RoundAnnouncer) {
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
      const dto = await toRoundDto(db, round);
      // Spec §5: both round-start entry points announce in the group chat.
      await roundAnnouncer.announceRoundOpened(dto.vendorName);
      reply.code(201).send(dto);
    });

    api.post<{ Params: { roundId: string } }>(
      '/:roundId/close',
      { preHandler: requireAdmin },
      async (req) => {
        const roundId = Number(req.params.roundId);
        // Atomic: if checklist generation fails, the status flip is rolled back too,
        // so the round stays open and the close attempt is cleanly retryable.
        await runInTransaction(db, async () => {
          await closeRound(db, roundId);
          await generateOrUpdateChecklist(db, roundId);
        });
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
