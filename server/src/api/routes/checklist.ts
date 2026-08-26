import type { FastifyInstance } from 'fastify';
import { eq } from 'drizzle-orm';
import type { Db } from '../../db/client';
import { brands, flavors, weights } from '../../db/schema';
import { requireAdmin } from '../middleware/authenticate';
import { listChecklist, adjustReceivedQty, type ChecklistRow } from '../../domain/checklist';

async function toChecklistDto(db: Db, row: ChecklistRow) {
  const [brand, flavor, weight] = await Promise.all([
    db.select().from(brands).where(eq(brands.id, row.brandId)).get(),
    db.select().from(flavors).where(eq(flavors.id, row.flavorId)).get(),
    db.select().from(weights).where(eq(weights.id, row.weightId)).get(),
  ]);
  return {
    id: row.id,
    brandId: row.brandId,
    brandName: brand?.name ?? '',
    flavorId: row.flavorId,
    flavorName: flavor?.name ?? '',
    weightId: row.weightId,
    grams: weight?.grams ?? 0,
    expectedQty: row.expectedQty,
    receivedQty: row.receivedQty,
  };
}

export function checklistRoutes(db: Db) {
  return async function routes(api: FastifyInstance) {
    api.addHook('preHandler', requireAdmin);

    api.get<{ Params: { roundId: string } }>('/', async (req) => {
      const rows = await listChecklist(db, Number(req.params.roundId));
      return Promise.all(rows.map((row) => toChecklistDto(db, row)));
    });

    api.post<{ Params: { roundId: string; itemId: string }; Body: { delta: number } }>(
      '/:itemId/adjust',
      async (req) => {
        const row = await adjustReceivedQty(db, Number(req.params.itemId), req.body.delta);
        return toChecklistDto(db, row);
      }
    );
  };
}
