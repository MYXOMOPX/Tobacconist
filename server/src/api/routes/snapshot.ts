import type { FastifyInstance } from 'fastify';
import type { Db } from '../../db/client';
import { requireAdmin } from '../middleware/authenticate';
import { computeAggregateSummary } from '../../domain/summary';
import { buildTextSnapshot, buildTableSnapshot } from '../../domain/snapshot';
import { buildSnapshotWorkbook } from '../../domain/xlsx';
import type { DocumentSender } from '../../telegram/notify';

export function snapshotRoutes(db: Db, documentSender: DocumentSender) {
  return async function routes(api: FastifyInstance) {
    api.addHook('preHandler', requireAdmin);

    api.get<{ Params: { roundId: string } }>('/', async (req) => {
      const { lines } = await computeAggregateSummary(db, Number(req.params.roundId));
      return { text: buildTextSnapshot(lines), table: buildTableSnapshot(lines) };
    });

    api.post<{ Params: { roundId: string } }>('/export', async (req) => {
      const roundId = Number(req.params.roundId);
      const { lines } = await computeAggregateSummary(db, roundId);
      const table = buildTableSnapshot(lines);
      const buffer = await buildSnapshotWorkbook(table);
      await documentSender.sendDocument(req.authedUser!.telegramId, buffer, `order-round-${roundId}.xlsx`);
      return { sent: true };
    });
  };
}
