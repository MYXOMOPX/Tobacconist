import { useEffect, useState } from 'react';
import { api } from '../apiClient';
import { useAction } from '../useAction';
import type { MyOrderDto, OrderDto, Vendor } from '../types';
import {
  Banner,
  Button,
  Card,
  EmptyState,
  ListSkeleton,
  Money,
  Row,
  Sheet,
  StatusBadge,
  Weight,
} from '../ui';

type OrderCard = { order: OrderDto; mine: MyOrderDto | null };

/**
 * Spec §5: several vendors can be collecting at once, so the participant picks
 * which order to open rather than landing in whichever one happens to be active.
 *
 * The admin sees exactly this list and orders from it like everybody else — the
 * management view is one deliberate tap away, not the default.
 */
export function ActiveOrdersPage({
  isAdmin = false,
  onOpen,
  onManage,
}: {
  isAdmin?: boolean;
  onOpen: (orderId: number) => void;
  onManage?: (orderId: number) => void;
}) {
  const [cards, setCards] = useState<OrderCard[]>([]);
  const [vendors, setVendors] = useState<Vendor[]>([]);
  const [picking, setPicking] = useState(false);
  const [loading, setLoading] = useState(true);
  const { error, run } = useAction();

  function load() {
    return run(async () => {
      const orders = await api.get<OrderDto[]>('/orders');
      setCards(
        await Promise.all(
          orders.map(async (order) => ({
            order,
            mine: await api.get<MyOrderDto>(`/orders/${order.id}/mine`).catch(() => null),
          }))
        )
      );
      if (isAdmin) setVendors(await api.get<Vendor[]>('/admin/vendors'));
    });
  }

  useEffect(() => {
    load().finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [run, isAdmin]);

  function startOrder(vendorId: number) {
    return run(async () => {
      const created = await api.post<OrderDto>('/orders', { vendorId });
      setPicking(false);
      onOpen(created.id);
    });
  }

  if (loading) {
    return (
      <div className="tb-page">
        <ListSkeleton />
      </div>
    );
  }

  const activeByVendor = new Map(cards.map(({ order }) => [order.vendorId, order]));

  return (
    <div className="tb-page">
      <h1 className="tb-title">Активные заказы</h1>
      {error && <Banner tone="danger">{error}</Banner>}

      {cards.length === 0 ? (
        <EmptyState
          title="Активных заказов нет"
          text={
            isAdmin
              ? 'Открой заказ у барыги — участники сразу увидят его в своём списке.'
              : 'Как только админ откроет закупку у барыги, она появится здесь.'
          }
        />
      ) : (
        <div className="tb-stack">
          {cards.map(({ order, mine }) => (
            <Card key={order.id}>
              <Row
                label={order.vendorName}
                note={
                  mine && mine.items.length > 0 ? (
                    <>
                      у тебя {mine.items.length} поз. · <Money value={mine.totalEur} /> ·{' '}
                      <Weight kg={mine.totalKg} tone="muted" />
                    </>
                  ) : (
                    'ты ещё не заказывал'
                  )
                }
                trailing={<StatusBadge status={order.status} />}
                onClick={() => onOpen(order.id)}
              />
              {isAdmin && onManage && (
                <Button block onClick={() => onManage(order.id)}>
                  Управление
                </Button>
              )}
            </Card>
          ))}
        </div>
      )}

      {isAdmin && (
        <>
          <Button variant="primary" block onClick={() => setPicking(true)}>
            Новый заказ
          </Button>

          <Sheet open={picking} title="У кого закупаемся?" onClose={() => setPicking(false)}>
            {vendors.filter((vendor) => !vendor.archived).length === 0 ? (
              <EmptyState title="Барыг ещё нет" text="Заведи барыгу на вкладке «Барыги»." />
            ) : (
              vendors
                .filter((vendor) => !vendor.archived)
                .map((vendor) => {
                  const busy = activeByVendor.get(vendor.id);
                  return (
                    <Row
                      key={vendor.id}
                      label={vendor.name}
                      note={busy ? 'уже есть активный заказ' : undefined}
                      trailing={busy ? <StatusBadge status={busy.status} /> : undefined}
                      disabled={Boolean(busy)}
                      onClick={() => startOrder(vendor.id)}
                    />
                  );
                })
            )}
          </Sheet>
        </>
      )}
    </div>
  );
}
