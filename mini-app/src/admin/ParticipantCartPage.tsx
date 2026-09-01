import { useCallback, useEffect, useState } from 'react';
import { api } from '../apiClient';
import { useAction } from '../useAction';
import type { AssortmentRow, OrderStatus, ParticipantSummary } from '../types';
import {
  Banner,
  Card,
  CardHead,
  ListSkeleton,
  Money,
  Stepper,
  Toggle,
  Weight,
  gramsLabel,
} from '../ui';

function lineKey(brandId: number, flavorId: number, weightId: number) {
  return `${brandId}:${flavorId}:${weightId}`;
}

/**
 * Spec §11 screen 7: the admin edits someone else's basket. It is the same
 * shape as OrderBuilderPage, but every write carries the participant's userId
 * instead of the caller's own — the server only accepts that field from admins.
 */
export function ParticipantCartPage({
  orderId,
  userId,
  displayName,
  status,
  onBack,
}: {
  orderId: number;
  userId: number;
  displayName: string;
  status: OrderStatus;
  onBack: () => void;
}) {
  const [assortment, setAssortment] = useState<AssortmentRow[]>([]);
  const [summaries, setSummaries] = useState<ParticipantSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const { error, run } = useAction();

  const reloadSummaries = useCallback(async () => {
    setSummaries(await api.get<ParticipantSummary[]>(`/orders/${orderId}/summaries`));
  }, [orderId]);

  const reload = useCallback(async () => {
    setAssortment(await api.get<AssortmentRow[]>(`/orders/${orderId}/assortment`));
    await reloadSummaries();
  }, [orderId, reloadSummaries]);

  useEffect(() => {
    setLoading(true);
    run(reload).finally(() => setLoading(false));
  }, [reload, run]);

  function setQuantity(
    line: { brandId: number; flavorId: number; weightId: number },
    quantity: number
  ) {
    return run(async () => {
      await api.put(`/orders/${orderId}/items`, {
        brandId: line.brandId,
        flavorId: line.flavorId,
        weightId: line.weightId,
        quantity,
        userId,
      });
      await reloadSummaries();
    });
  }

  function togglePaid(paid: boolean) {
    return run(async () => {
      await api.post(`/orders/${orderId}/payments/${userId}`, { paid });
      await reloadSummaries();
    });
  }

  if (loading) {
    return (
      <div className="tb-page">
        <ListSkeleton />
      </div>
    );
  }

  // Only an open collection or the reconciliation window let composition change;
  // money keeps moving after that (spec §10), so the toggle below is never locked.
  const locked = status !== 'ordering' && status !== 'awaiting_validation';

  const participant = summaries.find((p) => p.userId === userId);
  const paid = participant?.paid ?? false;
  const totalEur = participant?.totalEur ?? 0;
  const totalKg = participant?.totalKg ?? 0;

  const byBrand = new Map<string, AssortmentRow[]>();
  for (const row of assortment) {
    const list = byBrand.get(row.brandName) ?? [];
    list.push(row);
    byBrand.set(row.brandName, list);
  }

  const sameLine = (
    a: { brandId: number; flavorId: number; weightId: number },
    b: { brandId: number; flavorId: number; weightId: number }
  ) => a.brandId === b.brandId && a.flavorId === b.flavorId && a.weightId === b.weightId;

  const quantityOf = (row: AssortmentRow) =>
    participant?.items.find((item) => sameLine(item, row))?.quantity ?? 0;

  /**
   * Spec §12: a line stays in the order after its flavour goes out of stock, and
   * the assortment below lists only what is in stock — so these lines would be
   * invisible here while still padding the total. Deciding their fate is half of
   * why this screen exists, so they get their own card at the top.
   */
  const soldOut = (participant?.items ?? []).filter(
    (item) => !assortment.some((row) => sameLine(item, row))
  );

  return (
    <div className="tb-page">
      <header className="tb-card__head">
        <div className="tb-row__label">
          <h1 className="tb-title">{displayName}</h1>
          <button type="button" className="tb-btn tb-btn--ghost" onClick={onBack}>
            ← К заказу
          </button>
        </div>
      </header>

      {error && <Banner tone="danger">{error}</Banner>}
      {locked && <Banner tone="warning">Заказ закрыт, состав больше не меняется</Banner>}

      <Card>
        <Toggle label="Оплачено" pressed={paid} onChange={togglePaid} />
        <div className="tb-card__head">
          <span className="tb-subtitle">Итого</span>
          <span>
            <Money value={totalEur} tone="accent" /> · <Weight kg={totalKg} tone="muted" />
          </span>
        </div>
      </Card>

      {soldOut.length > 0 && (
        <Card>
          <CardHead title="Больше не в наличии" />
          {soldOut.map((item) => (
            <div
              className="tb-ledger tb-ledger--unavailable"
              key={lineKey(item.brandId, item.flavorId, item.weightId)}
            >
              <span className="tb-ledger__label">
                <span className="tb-ledger__name">
                  {item.brandName} {item.flavorName}
                </span>
                <span className="tb-ledger__meta">{gramsLabel(item.grams)}</span>
              </span>
              <span className="tb-ledger__rail" aria-hidden="true" />
              <Stepper
                value={item.quantity}
                max={item.quantity}
                onChange={(next) => setQuantity(item, next)}
                disabled={locked}
                label={`${item.brandName} ${item.flavorName} ${gramsLabel(item.grams)}`}
              />
            </div>
          ))}
        </Card>
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
    </div>
  );
}
