import { useCallback, useEffect, useState } from 'react';
import { api } from '../apiClient';
import { useAction } from '../useAction';
import type { AssortmentRow, MyOrderDto } from '../types';
import {
  Banner,
  Button,
  Card,
  CardHead,
  EmptyState,
  ListSkeleton,
  Money,
  StatusBadge,
  Stepper,
  StickyBar,
  Weight,
  gramsLabel,
} from '../ui';

function lineKey(brandId: number, flavorId: number, weightId: number) {
  return `${brandId}:${flavorId}:${weightId}`;
}

export function OrderBuilderPage({
  orderId,
  onBack,
  onContinue,
  onManage,
}: {
  orderId: number;
  onBack: () => void;
  /** Steps to the composed order — the totals and the readiness switch live there now. */
  onContinue: () => void;
  /** Only the admin gets this: it steps out of ordering and into moderation. */
  onManage?: () => void;
}) {
  const [assortment, setAssortment] = useState<AssortmentRow[]>([]);
  const [mine, setMine] = useState<MyOrderDto | null>(null);
  const [loading, setLoading] = useState(true);
  const { error, run } = useAction();

  const reload = useCallback(async () => {
    setAssortment(await api.get<AssortmentRow[]>(`/orders/${orderId}/assortment`));
    setMine(await api.get<MyOrderDto>(`/orders/${orderId}/mine`));
  }, [orderId]);

  useEffect(() => {
    setLoading(true);
    run(reload).finally(() => setLoading(false));
  }, [reload, run]);

  function setQuantity(row: AssortmentRow, quantity: number) {
    return run(async () => {
      await api.put(`/orders/${orderId}/items`, {
        brandId: row.brandId,
        flavorId: row.flavorId,
        weightId: row.weightId,
        quantity,
      });
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
        <EmptyState title="Заказ не открывается" text="Вернись к списку и попробуй ещё раз." />
        <Button onClick={onBack}>К списку заказов</Button>
      </div>
    );
  }

  const locked = mine.order.status !== 'ordering';

  const byBrand = new Map<string, AssortmentRow[]>();
  for (const row of assortment) {
    const list = byBrand.get(row.brandName) ?? [];
    list.push(row);
    byBrand.set(row.brandName, list);
  }

  const quantityOf = (row: AssortmentRow) =>
    mine.items.find(
      (item) =>
        item.brandId === row.brandId &&
        item.flavorId === row.flavorId &&
        item.weightId === row.weightId
    )?.quantity ?? 0;

  return (
    <div className="tb-page">
      <header className="tb-card__head">
        <div className="tb-row__label">
          <h1 className="tb-title">{mine.order.vendorName}</h1>
          <button type="button" className="tb-btn tb-btn--ghost" onClick={onBack}>
            ← Все заказы
          </button>
        </div>
        <StatusBadge status={mine.order.status} />
      </header>

      {onManage && (
        <Button block onClick={onManage}>
          Управление заказом
        </Button>
      )}

      {error && <Banner tone="danger">{error}</Banner>}
      {locked && <Banner tone="warning">Добавление позиций закрыто, идёт сверка с продавцом</Banner>}
      {mine.hasUnavailableItems && (
        <Banner tone="warning">Часть позиций больше не в наличии — реши, оставляем их или убираем</Banner>
      )}

      {[...byBrand.entries()].map(([brandName, rows]) => (
        <Card key={brandName}>
          <CardHead title={brandName} />
          {rows.map((row) => (
            <div className="tb-ledger" key={lineKey(row.brandId, row.flavorId, row.weightId)}>
              <span className="tb-ledger__label">
                <span className="tb-ledger__name">{row.flavorName}</span>
                <span className="tb-ledger__meta">{gramsLabel(row.grams)}</span>
              </span>
              <span className="tb-ledger__rail" aria-hidden="true" />
              <Stepper
                value={quantityOf(row)}
                onChange={(next) => setQuantity(row, next)}
                disabled={locked}
                label={`${row.flavorName} ${gramsLabel(row.grams)}`}
              />
            </div>
          ))}
        </Card>
      ))}

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
          // The composed order is always worth a look, locked or not.
          <Button variant="primary" onClick={onContinue}>
            Продолжить
          </Button>
        }
      />
    </div>
  );
}
