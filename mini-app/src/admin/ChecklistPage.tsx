import { useCallback, useEffect, useState } from 'react';
import { api } from '../apiClient';
import { useAction } from '../useAction';
import type { ChecklistItem } from '../types';
import { Banner, Button, Card, ListSkeleton, Progress, Stepper, gramsLabel } from '../ui';

/**
 * Delivery reconciliation, one order at a time: how much of each position
 * actually arrived versus what was ordered. Saves on every stepper change so
 * leaving and coming back keeps the numbers (they live on the server).
 */
export function ChecklistPage({
  orderId,
  onBack,
  onFinish,
}: {
  orderId: number;
  onBack: () => void;
  onFinish: () => void;
}) {
  const [checklist, setChecklist] = useState<ChecklistItem[]>([]);
  const [loading, setLoading] = useState(true);
  const { error, run } = useAction();

  const reload = useCallback(async () => {
    setChecklist(await api.get<ChecklistItem[]>(`/orders/${orderId}/checklist`));
  }, [orderId]);

  useEffect(() => {
    setLoading(true);
    run(reload).finally(() => setLoading(false));
  }, [reload, run]);

  function adjust(itemId: number, delta: number) {
    return run(async () => {
      await api.post(`/orders/${orderId}/checklist/${itemId}/adjust`, { delta });
      setChecklist(await api.get<ChecklistItem[]>(`/orders/${orderId}/checklist`));
    });
  }

  if (loading) {
    return (
      <div className="tb-page">
        <ListSkeleton />
      </div>
    );
  }

  const receivedTotal = checklist.reduce((sum, item) => sum + item.receivedQty, 0);
  const expectedTotal = checklist.reduce((sum, item) => sum + item.expectedQty, 0);

  return (
    <div className="tb-page">
      <header className="tb-card__head">
        <div className="tb-row__label">
          <h1 className="tb-title">Сверка поставки</h1>
          <button type="button" className="tb-btn tb-btn--ghost" onClick={onBack}>
            ← К заказу
          </button>
        </div>
      </header>

      {error && <Banner tone="danger">{error}</Banner>}

      <Card>
        <Progress
          label="Принято"
          value={receivedTotal}
          max={expectedTotal}
          trailing={
            <span className="tb-num tb-num--muted">
              {receivedTotal} / {expectedTotal}
            </span>
          }
        />
        {checklist.map((item) => (
          <div className="tb-ledger" key={item.id}>
            <span className="tb-ledger__label">
              <span className="tb-ledger__name">
                {item.brandName} {item.flavorName}
              </span>
              <span className="tb-ledger__meta">{gramsLabel(item.grams)}</span>
              <span className="tb-ledger__note">нужно {item.expectedQty}</span>
            </span>
            <span className="tb-ledger__rail" aria-hidden="true" />
            <Stepper
              value={item.receivedQty}
              max={999}
              onChange={(next) => adjust(item.id, next - item.receivedQty)}
              label={`${item.brandName} ${item.flavorName} ${gramsLabel(item.grams)}`}
            />
          </div>
        ))}
      </Card>

      <Button variant="primary" block onClick={onFinish}>
        Завершить заказ
      </Button>
    </div>
  );
}
