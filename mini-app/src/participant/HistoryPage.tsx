import { useEffect, useState } from 'react';
import { api } from '../apiClient';
import { useAction } from '../useAction';
import type { AggregateLine, OrderDto } from '../types';
import {
  Badge,
  Banner,
  Card,
  CardHead,
  EmptyState,
  LedgerRow,
  ListSkeleton,
  Money,
  Row,
  StatusBadge,
  Weight,
  gramsLabel,
} from '../ui';

type OrderDetail = {
  order: OrderDto;
  items: AggregateLine[];
  totalKg: number;
  totalEur: number;
  paid: boolean;
};

export function HistoryPage() {
  const [orders, setOrders] = useState<OrderDto[]>([]);
  const [selected, setSelected] = useState<OrderDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const { error, run } = useAction();

  useEffect(() => {
    run(async () => {
      setOrders(await api.get<OrderDto[]>('/history'));
    }).finally(() => setLoading(false));
  }, [run]);

  function openOrder(id: number) {
    return run(async () => {
      setSelected(await api.get<OrderDetail>(`/history/${id}`));
    });
  }

  return (
    <div className="tb-page">
      <h1 className="tb-title">История закупок</h1>
      {error && <Banner tone="danger">{error}</Banner>}

      {loading ? (
        <ListSkeleton />
      ) : orders.length === 0 ? (
        <EmptyState
          title="Здесь пока пусто"
          text="Завершённые и отменённые заказы остаются тут вместе с составом и оплатами."
        />
      ) : (
        <div className="tb-stack">
          {orders.map((order) => (
            <Row
              key={order.id}
              label={order.vendorName}
              note={new Date(order.statusChangedAt).toLocaleDateString('ru-RU')}
              trailing={<StatusBadge status={order.status} />}
              onClick={() => openOrder(order.id)}
            />
          ))}
        </div>
      )}

      {selected && (
        <Card>
          <CardHead
            title={selected.order.vendorName}
            trailing={<Badge>{selected.paid ? 'Оплачено' : 'Не оплачено'}</Badge>}
          />
          {selected.items.map((item) => (
            <LedgerRow
              key={`${item.brandId}:${item.flavorId}:${item.weightId}`}
              name={`${item.brandName} ${item.flavorName}`}
              meta={gramsLabel(item.grams)}
              quantity={item.quantity}
              amount={item.totalEur}
              note={
                item.deliveredQty !== null && item.deliveredQty !== item.quantity
                  ? `досталось ${item.deliveredQty}`
                  : undefined
              }
            />
          ))}
          <div className="tb-card__head">
            <span className="tb-subtitle">Общий вес</span>
            <Weight kg={selected.totalKg} />
          </div>
          <div className="tb-card__head">
            <span>Итого</span>
            <Money value={selected.totalEur} tone="accent" />
          </div>
        </Card>
      )}
    </div>
  );
}
