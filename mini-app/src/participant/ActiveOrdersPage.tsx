import { useEffect, useState } from 'react';
import { api } from '../apiClient';
import { useAction } from '../useAction';
import type { MyOrderDto, OrderDto } from '../types';
import { Banner, EmptyState, ListSkeleton, Money, Row, StatusBadge, Weight } from '../ui';

type Card = { order: OrderDto; mine: MyOrderDto | null };

/**
 * Spec §5: several vendors can be collecting at once, so the participant picks
 * which order to open rather than landing in whichever one happens to be active.
 */
export function ActiveOrdersPage({ onOpen }: { onOpen: (orderId: number) => void }) {
  const [cards, setCards] = useState<Card[]>([]);
  const [loading, setLoading] = useState(true);
  const { error, run } = useAction();

  function load() {
    return run(async () => {
      const orders = await api.get<OrderDto[]>('/orders');
      const withMine = await Promise.all(
        orders.map(async (order) => ({
          order,
          mine: await api.get<MyOrderDto>(`/orders/${order.id}/mine`).catch(() => null),
        }))
      );
      setCards(withMine);
    });
  }

  useEffect(() => {
    load().finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [run]);

  if (loading) {
    return (
      <div className="tb-page">
        <ListSkeleton />
      </div>
    );
  }

  return (
    <div className="tb-page">
      <h1 className="tb-title">Активные заказы</h1>
      {error && <Banner tone="danger">{error}</Banner>}

      {cards.length === 0 ? (
        <EmptyState
          title="Активных заказов нет"
          text="Как только админ откроет закупку у барыги, она появится здесь."
        />
      ) : (
        <div className="tb-stack">
          {cards.map(({ order, mine }) => (
            <Row
              key={order.id}
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
          ))}
        </div>
      )}
    </div>
  );
}
