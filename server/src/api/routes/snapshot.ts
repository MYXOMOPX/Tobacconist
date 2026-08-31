import type { FastifyInstance } from 'fastify';
import type { Db } from '../../db/client.js';
import { requireAdmin } from '../middleware/authenticate.js';
import { computeAggregateSummary } from '../../domain/summary.js';
import { buildTextSnapshot, buildTableSnapshot } from '../../domain/snapshot.js';
import { buildSnapshotWorkbook } from '../../domain/xlsx.js';
import type { DocumentSender } from '../../telegram/notify.js';

export function snapshotRoutes(db: Db, documentSender: DocumentSender) {
  return async function routes(api: FastifyInstance) {
    api.addHook('preHandler', requireAdmin);

    api.get<{ Params: { orderId: string } }>('/', async (req) => {
      const { lines } = await computeAggregateSummary(db, Number(req.params.orderId));
      return { text: buildTextSnapshot(lines), table: buildTableSnapshot(lines) };
    });

    api.post<{ Params: { orderId: string } }>('/export', async (req) => {
      const orderId = Number(req.params.orderId);
      const { lines } = await computeAggregateSummary(db, orderId);
      const table = buildTableSnapshot(lines);
      const buffer = await buildSnapshotWorkbook(table);
      await documentSender.sendDocument(req.authedUser!.telegramId, buffer, `order-${orderId}.xlsx`);
      return { sent: true };
    });
  };
}
