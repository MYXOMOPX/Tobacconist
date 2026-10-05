import { useEffect, useState } from 'react';
import { api } from '../apiClient';
import { useAction } from '../useAction';
import type { AggregateLine, OrderDto } from '../types';
import {
  Badge,
  Banner,
  Button,
  Card,
  CardHead,
  ConfirmDialog,
  EmptyState,
  LedgerRow,
  ListSkeleton,
  Money,
  Row,
  StatusBadge,
  Toggle,
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

/**
 * Spec §10: closed orders stay whole and read-only. The admin still steps into
 * one — a delivery gets paid for after it is over, and the payment marks are the
 * one thing that keeps moving in a finished order.
 */
export function HistoryPage({
  isAdmin = false,
  onManage,
}: {
  isAdmin?: boolean;
  onManage?: (orderId: number) => void;
} = {}) {
  const [orders, setOrders] = useState<OrderDto[]>([]);
  const [selected, setSelected] = useState<OrderDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [cleaning, setCleaning] = useState(false);
  const [picked, setPicked] = useState<Set<number>>(new Set());
  const [confirming, setConfirming] = useState(false);
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

  function togglePicked(id: number) {
    const next = new Set(picked);
    if (!next.delete(id)) next.add(id);
    setPicked(next);
  }

  function stopCleaning() {
    setCleaning(false);
    setPicked(new Set());
    setConfirming(false);
  }

  function deletePicked() {
    return run(async () => {
      await api.post('/history/delete', { orderIds: [...picked] });
      setOrders(orders.filter((order) => !picked.has(order.id)));
      setSelected(null);
      stopCleaning();
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
          {isAdmin &&
            (cleaning ? (
              <>
                <Button
                  variant="destructive"
                  block
                  disabled={picked.size === 0}
                  onClick={() => setConfirming(true)}
                >
                  Удалить выбранные ({picked.size})
                </Button>
                <Button block onClick={stopCleaning}>
                  Отмена
                </Button>
              </>
            ) : (
              <Button block onClick={() => setCleaning(true)}>
                Очистить историю
              </Button>
            ))}
          {orders.map((order) =>
            cleaning ? (
              <Toggle
                key={order.id}
                label={`${order.vendorName} · ${new Date(order.statusChangedAt).toLocaleDateString('ru-RU')}`}
                pressed={picked.has(order.id)}
                onChange={() => togglePicked(order.id)}
                trailing={<StatusBadge status={order.status} />}
              />
            ) : (
            <Card key={order.id}>
              <Row
                label={order.vendorName}
                note={new Date(order.statusChangedAt).toLocaleDateString('ru-RU')}
                trailing={<StatusBadge status={order.status} />}
                onClick={() => openOrder(order.id)}
              />
              {isAdmin && onManage && (
                <Button block onClick={() => onManage(order.id)}>
                  Управление
                </Button>
              )}
            </Card>
            )
          )}
        </div>
      )}

      <ConfirmDialog
        open={confirming}
        title={`Удалить заказов: ${picked.size}?`}
        confirmLabel="Удалить навсегда"
        onConfirm={deletePicked}
        onCancel={() => setConfirming(false)}
        body={
          <p className="tb-subtitle">
            Заказы удалятся целиком: состав, оплаты и чек-листы. Вернуть их нельзя.
          </p>
        }
      />

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
