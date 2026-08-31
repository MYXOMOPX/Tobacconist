import { useCallback, useEffect, useState } from 'react';
import { api } from '../apiClient';
import { useAction } from '../useAction';
import type { MyOrderDto } from '../types';
import {
  Banner,
  Button,
  Card,
  CardHead,
  EmptyState,
  LedgerRow,
  ListSkeleton,
  Money,
  StatusBadge,
  StickyBar,
  Weight,
  gramsLabel,
} from '../ui';

function lineKey(brandId: number, flavorId: number, weightId: number) {
  return `${brandId}:${flavorId}:${weightId}`;
}

/**
 * The composed order, split out of the picking screen: once someone has
 * chosen tobacco they come here to see the totals and to mark themselves
 * ready, without the whole assortment competing for the same screen.
 */
export function MyOrderPage({ orderId, onBack }: { orderId: number; onBack: () => void }) {
  const [mine, setMine] = useState<MyOrderDto | null>(null);
  const [loading, setLoading] = useState(true);
  const { error, run } = useAction();

  const reload = useCallback(async () => {
    setMine(await api.get<MyOrderDto>(`/orders/${orderId}/mine`));
  }, [orderId]);

  useEffect(() => {
    setLoading(true);
    run(reload).finally(() => setLoading(false));
  }, [reload, run]);

  function setReady(ready: boolean) {
    return run(async () => {
      await api.post(`/orders/${orderId}/ready`, { ready });
      setMine(await api.get<MyOrderDto>(`/orders/${orderId}/mine`));
    });
  }

  if (loading) {
    return (
      <div className="tb-page">
        <ListSkeleton />
      </div>
    );
  }

  if (!mine) {
    return (
      <div className="tb-page">
        {error && <Banner tone="danger">{error}</Banner>}
        <EmptyState title="Заказ не открывается" text="Вернись к выбору табака и попробуй ещё раз." />
        <Button onClick={onBack}>← К выбору</Button>
      </div>
    );
  }

  const locked = mine.order.status !== 'ordering';

  return (
    <div className="tb-page">
      <header className="tb-card__head">
        <div className="tb-row__label">
          <h1 className="tb-title">{mine.order.vendorName}</h1>
          <button type="button" className="tb-btn tb-btn--ghost" onClick={onBack}>
            ← К выбору
          </button>
        </div>
        <StatusBadge status={mine.order.status} />
      </header>

      {error && <Banner tone="danger">{error}</Banner>}
      {locked && <Banner tone="warning">Добавление позиций закрыто, идёт сверка с продавцом</Banner>}
      {mine.hasUnavailableItems && (
        <Banner tone="warning">Часть позиций больше не в наличии — реши, оставляем их или убираем</Banner>
      )}

      {mine.items.length === 0 ? (
        <EmptyState title="Пока пусто" text="Вернись к выбору табака и добавь позиции." />
      ) : (
        <Card>
          <CardHead title="Твои позиции" />
          {mine.items.map((item) => (
            <LedgerRow
              key={lineKey(item.brandId, item.flavorId, item.weightId)}
              name={`${item.brandName} ${item.flavorName}`}
              meta={gramsLabel(item.grams)}
              quantity={item.quantity}
              amount={item.totalEur}
              unavailable={!item.available}
              note={
                item.deliveredQty !== null && item.deliveredQty !== item.quantity
                  ? `досталось ${item.deliveredQty}`
                  : item.available
                    ? undefined
                    : 'больше не в наличии'
              }
            />
          ))}
        </Card>
      )}

      <StickyBar
        summary={
          <>
            <span className="tb-subtitle">Твой заказ: {mine.items.length} поз.</span>
            <span>
              <Money value={mine.totalEur} tone="accent" /> · <Weight kg={mine.totalKg} tone="muted" />
            </span>
          </>
        }
        action={
          locked ? undefined : (
            <Button variant={mine.ready ? 'secondary' : 'primary'} onClick={() => setReady(!mine.ready)}>
              {mine.ready ? 'Не готово' : 'Готово'}
            </Button>
          )
        }
      />
    </div>
  );
}
