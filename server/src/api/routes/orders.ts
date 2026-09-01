import type { FastifyInstance, FastifyRequest } from 'fastify';
import { eq } from 'drizzle-orm';
import { runInTransaction, type Db } from '../../db/client.js';
import { brands, flavors, users, vendors, weights } from '../../db/schema.js';
import { requireAdmin } from '../middleware/authenticate.js';
import {
  createOrder,
  getOrder,
  listActiveOrders,
  setOrderStatus,
  type Order,
  type OrderStatus,
} from '../../domain/orders.js';
import { upsertOrderItem } from '../../domain/orderItems.js';
import { listVendorAssortment } from '../../domain/availability.js';
import { computeUserSummary } from '../../domain/summary.js';
import { generateOrUpdateChecklist } from '../../domain/checklist.js';
import { applyDelivery, clearDelivery, listDiscrepancies } from '../../domain/distribution.js';
import {
  clearAllReadiness,
  getPaymentStatus,
  getReadiness,
  setReadiness,
} from '../../domain/participants.js';
import type { OrderAnnouncer } from '../../telegram/notify.js';

export async function toOrderDto(db: Db, order: Order) {
  const vendor = await db.select().from(vendors).where(eq(vendors.id, order.vendorId)).get();
  return {
    id: order.id,
    vendorId: order.vendorId,
    vendorName: vendor?.name ?? '',
    status: order.status,
    createdAt: order.createdAt,
    statusChangedAt: order.statusChangedAt,
  };
}

async function loadOrder(db: Db, raw: string) {
  const order = await getOrder(db, Number(raw));
  if (!order) {
    const err = new Error('order not found') as Error & { statusCode?: number };
    err.statusCode = 404;
    throw err;
  }
  return order;
}

export function ordersRoutes(db: Db, orderAnnouncer: OrderAnnouncer) {
  /**
   * The order is already saved by the time the group is told about it, so a
   * failed announcement must not be reported as a failed request — that used to
   * leave the admin staring at an error next to an order that did exist.
   */
  async function announce(req: FastifyRequest, send: () => Promise<void>) {
    try {
      await send();
    } catch (err) {
      req.log.error({ err }, 'order announcement failed');
    }
  }

  return async function routes(api: FastifyInstance) {
    /** Spec §5: several vendors can be collecting at once, so this is a list. */
    api.get('/', async () => {
      const orders = await listActiveOrders(db);
      return Promise.all(orders.map((order) => toOrderDto(db, order)));
    });

    api.post<{ Body: { vendorId: number } }>('/', { preHandler: requireAdmin }, async (req, reply) => {
      const order = await createOrder(db, req.body.vendorId, req.authedUser!.id);
      const dto = await toOrderDto(db, order);
      // Spec §5: both order-start entry points announce in the group chat.
      await announce(req, () => orderAnnouncer.announceOrderOpened(dto.vendorName, dto.id));
      reply.code(201).send(dto);
    });

    api.get<{ Params: { orderId: string } }>('/:orderId', async (req) => {
      return toOrderDto(db, await loadOrder(db, req.params.orderId));
    });

    api.post<{ Params: { orderId: string }; Body: { status: OrderStatus } }>(
      '/:orderId/status',
      { preHandler: requireAdmin },
      async (req) => {
        const order = await loadOrder(db, req.params.orderId);
        const next = req.body.status;

        if (next === 'done') {
          throw new Error('finishing an order goes through /finish, so the delivery gets recorded');
        }

        // Atomic: if the follow-up work fails, the status flip is rolled back too,
        // so the order stays where it was and the attempt is cleanly retryable.
        await runInTransaction(db, async () => {
          await setOrderStatus(db, order.id, next);
          if (next === 'awaiting_validation') {
            await generateOrUpdateChecklist(db, order.id);
          }
          if (next === 'ordering') {
            // Back to collecting: the composition changes again, so old readiness
            // marks and any recorded delivery no longer describe this order.
            await clearAllReadiness(db, order.id);
            await clearDelivery(db, order.id);
          }
        });

        const dto = await toOrderDto(db, (await getOrder(db, order.id))!);
        await announce(req, () => orderAnnouncer.announceStatusChanged(dto.vendorName, dto.id, next));
        return dto;
      }
    );

    /** Spec §7.1: what the vendor brought, per participant. */
    api.get<{ Params: { orderId: string } }>(
      '/:orderId/discrepancies',
      { preHandler: requireAdmin },
      async (req) => {
        const order = await loadOrder(db, req.params.orderId);
        const groups = await listDiscrepancies(db, order.id);
        // Named here rather than in the client: the screen has to say which
        // position is short, not show a row of ids.
        const [brandRows, flavorRows, weightRows] = await Promise.all([
          db.select().from(brands).all(),
          db.select().from(flavors).all(),
          db.select().from(weights).all(),
        ]);
        const userRows = await db.select().from(users).all();
        return groups.map((group) => ({
          ...group,
          brandName: brandRows.find((row) => row.id === group.brandId)?.name ?? '',
          flavorName: flavorRows.find((row) => row.id === group.flavorId)?.name ?? '',
          grams: weightRows.find((row) => row.id === group.weightId)?.grams ?? 0,
          participants: group.participants.map((participant) => ({
            ...participant,
            displayName: userRows.find((row) => row.id === participant.userId)?.displayName ?? '',
          })),
        }));
      }
    );

    api.post<{
      Params: { orderId: string };
      Body: { allocations?: { orderItemId: number; deliveredQty: number }[] };
    }>('/:orderId/finish', { preHandler: requireAdmin }, async (req) => {
      const order = await loadOrder(db, req.params.orderId);
      await runInTransaction(db, async () => {
        await applyDelivery(db, order.id, req.body?.allocations ?? []);
        await setOrderStatus(db, order.id, 'done');
      });
      const dto = await toOrderDto(db, (await getOrder(db, order.id))!);
      await announce(req, () => orderAnnouncer.announceStatusChanged(dto.vendorName, dto.id, 'done'));
      return dto;
    });

    api.get<{ Params: { orderId: string } }>('/:orderId/assortment', async (req) => {
      const order = await loadOrder(db, req.params.orderId);
      return listVendorAssortment(db, order.vendorId, { onlyAvailable: true });
    });

    api.get<{ Params: { orderId: string } }>('/:orderId/mine', async (req) => {
      const order = await loadOrder(db, req.params.orderId);
      const userId = req.authedUser!.id;
      const summary = await computeUserSummary(db, order.id, userId);
      return {
        order: await toOrderDto(db, order),
        ...summary,
        ready: await getReadiness(db, order.id, userId),
        paid: await getPaymentStatus(db, order.id, userId),
      };
    });

    api.put<{
      Params: { orderId: string };
      Body: { brandId: number; flavorId: number; weightId: number; quantity: number; userId?: number };
    }>('/:orderId/items', async (req) => {
      const order = await loadOrder(db, req.params.orderId);
      const isAdmin = req.authedUser!.role === 'admin';
      const item = await upsertOrderItem(db, {
        orderId: order.id,
        // Only the admin may act on someone else's behalf (spec §5).
        userId: isAdmin && req.body.userId ? req.body.userId : req.authedUser!.id,
        brandId: req.body.brandId,
        flavorId: req.body.flavorId,
        weightId: req.body.weightId,
        quantity: req.body.quantity,
        addedByUserId: req.authedUser!.id,
        byAdmin: isAdmin,
      });
      return { item };
    });

    api.post<{ Params: { orderId: string }; Body: { ready: boolean } }>(
      '/:orderId/ready',
      async (req) => {
        const order = await loadOrder(db, req.params.orderId);
        if (order.status !== 'ordering') {
          throw new Error('readiness only means something while the order is collecting');
        }
        return setReadiness(db, order.id, req.authedUser!.id, req.body.ready);
      }
    );
  };
}
