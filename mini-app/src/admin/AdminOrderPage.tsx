import { useCallback, useEffect, useState } from 'react';
import { api } from '../apiClient';
import { useAction } from '../useAction';
import type {
  ChecklistItem,
  Discrepancy,
  OrderDto,
  ParticipantSummary,
  SnapshotDto,
} from '../types';
import {
  Badge,
  Banner,
  Button,
  Card,
  CardHead,
  LedgerRow,
  ListSkeleton,
  Money,
  Progress,
  Snapshot,
  StatusBadge,
  Stepper,
  Toggle,
  Weight,
  gramsLabel,
} from '../ui';

type Allocations = Record<number, number>;

/**
 * Everyone starts with what they ordered, so the gap is a chore with a direction:
 * either the admin takes packs away from the position, or hands the extra out.
 */
function distributionHint(remaining: number) {
  if (remaining === 0) return 'распределено';
  return remaining < 0 ? `снять ${-remaining}` : `раздать ${remaining}`;
}

/** Everything the admin does to one order: composition, delivery, money (spec §5–§8). */
export function AdminOrderPage({
  orderId,
  onBack,
  onLeaveManagement,
}: {
  orderId: number;
  onBack: () => void;
  /** Back to ordering as a participant: the admin buys tobacco too. */
  onLeaveManagement?: () => void;
}) {
  const [order, setOrder] = useState<OrderDto | null>(null);
  const [participants, setParticipants] = useState<ParticipantSummary[]>([]);
  const [snapshot, setSnapshot] = useState<SnapshotDto | null>(null);
  const [checklist, setChecklist] = useState<ChecklistItem[]>([]);
  const [discrepancies, setDiscrepancies] = useState<Discrepancy[]>([]);
  const [allocations, setAllocations] = useState<Allocations>({});
  const [distributing, setDistributing] = useState(false);
  const [loading, setLoading] = useState(true);
  const { error, run } = useAction();

  const reload = useCallback(async () => {
    const loaded = await api.get<OrderDto>(`/orders/${orderId}`);
    setOrder(loaded);
    setParticipants(await api.get<ParticipantSummary[]>(`/orders/${orderId}/summaries`));
    setSnapshot(await api.get<SnapshotDto>(`/orders/${orderId}/snapshot`));
    setChecklist(
      loaded.status === 'ordering' ? [] : await api.get<ChecklistItem[]>(`/orders/${orderId}/checklist`)
    );
  }, [orderId]);

  useEffect(() => {
    setLoading(true);
    run(reload).finally(() => setLoading(false));
  }, [reload, run]);

  function changeStatus(status: OrderDto['status']) {
    return run(async () => {
      await api.post(`/orders/${orderId}/status`, { status });
      setDistributing(false);
      await reload();
    });
  }

  function adjustChecklist(itemId: number, delta: number) {
    return run(async () => {
      await api.post(`/orders/${orderId}/checklist/${itemId}/adjust`, { delta });
      setChecklist(await api.get<ChecklistItem[]>(`/orders/${orderId}/checklist`));
    });
  }

  function togglePaid(userId: number, paid: boolean) {
    return run(async () => {
      await api.post(`/orders/${orderId}/payments/${userId}`, { paid });
      setParticipants(await api.get<ParticipantSummary[]>(`/orders/${orderId}/summaries`));
    });
  }

  function startFinishing() {
    return run(async () => {
      const groups = await api.get<Discrepancy[]>(`/orders/${orderId}/discrepancies`);
      if (groups.length === 0) {
        await finish([]);
        return;
      }
      setDiscrepancies(groups);
      setAllocations(
        Object.fromEntries(
          groups.flatMap((group) =>
            group.participants.map((p) => [p.orderItemId, p.proposedDeliveredQty])
          )
        )
      );
      setDistributing(true);
    });
  }

  function finish(payload: { orderItemId: number; deliveredQty: number }[]) {
    return run(async () => {
      await api.post(`/orders/${orderId}/finish`, { allocations: payload });
      setDistributing(false);
      await reload();
    });
  }

  if (loading) {
    return (
      <div className="tb-page">
        <ListSkeleton />
      </div>
    );
  }

  if (!order) {
    return (
      <div className="tb-page">
        {error && <Banner tone="danger">{error}</Banner>}
        <Button onClick={onBack}>К списку заказов</Button>
      </div>
    );
  }

  // Distribution takes over the screen: it is a decision, not a side panel (§7.1).
  if (distributing) {
    const remainingFor = (group: Discrepancy) =>
      group.receivedQty -
      group.participants.reduce((sum, p) => sum + (allocations[p.orderItemId] ?? 0), 0);
    const settled = discrepancies.every((group) => remainingFor(group) === 0);

    return (
      <div className="tb-page">
        <header className="tb-card__head">
          <h1 className="tb-title">Что кому досталось</h1>
          <Button onClick={() => setDistributing(false)}>Назад</Button>
        </header>
        {error && <Banner tone="danger">{error}</Banner>}
        <Banner tone="warning">
          Привезли не то количество, что заказывали. Реши, у кого позиции меняются — суммы к оплате
          пересчитаются по факту.
        </Banner>

        {discrepancies.map((group) => {
          const remaining = remainingFor(group);
          return (
            <Card key={`${group.brandId}:${group.flavorId}:${group.weightId}`}>
              <CardHead
                title={`${group.brandName} ${group.flavorName}, ${gramsLabel(group.grams)}`}
                trailing={
                  <Badge tone={remaining === 0 ? 'ordering' : 'awaiting'}>
                    {distributionHint(remaining)}
                  </Badge>
                }
              />
              <p className="tb-subtitle">
                Заказывали {group.expectedQty}, привезли {group.receivedQty}.
              </p>
              {group.participants.map((participant) => {
                const name = participant.displayName || `Участник ${participant.userId}`;
                return (
                  <div className="tb-ledger" key={participant.orderItemId}>
                    <span className="tb-ledger__label">
                      <span className="tb-ledger__name">{name}</span>
                      <span className="tb-ledger__meta">заказал {participant.quantity}</span>
                    </span>
                    <span className="tb-ledger__rail" aria-hidden="true" />
                    <Stepper
                      value={allocations[participant.orderItemId] ?? 0}
                      max={999}
                      onChange={(next) =>
                        setAllocations({ ...allocations, [participant.orderItemId]: next })
                      }
                      label={`${name}, досталось`}
                    />
                  </div>
                );
              })}
            </Card>
          );
        })}

        <Button
          variant="primary"
          block
          disabled={!settled}
          onClick={() =>
            finish(
              Object.entries(allocations).map(([orderItemId, deliveredQty]) => ({
                orderItemId: Number(orderItemId),
                deliveredQty,
              }))
            )
          }
        >
          Завершить заказ
        </Button>
      </div>
    );
  }

  const receivedTotal = checklist.reduce((sum, item) => sum + item.receivedQty, 0);
  const expectedTotal = checklist.reduce((sum, item) => sum + item.expectedQty, 0);
  const paidCount = participants.filter((p) => p.paid).length;
  const collected = participants.filter((p) => p.paid).reduce((sum, p) => sum + p.totalEur, 0);
  const billed = participants.reduce((sum, p) => sum + p.totalEur, 0);

  return (
    <div className="tb-page">
      <header className="tb-card__head">
        <div className="tb-row__label">
          <h1 className="tb-title">{order.vendorName}</h1>
          <button type="button" className="tb-btn tb-btn--ghost" onClick={onBack}>
            ← Все заказы
          </button>
        </div>
        <StatusBadge status={order.status} />
      </header>

      {error && <Banner tone="danger">{error}</Banner>}

      {onLeaveManagement && (
        <Button block onClick={onLeaveManagement}>
          К своему заказу
        </Button>
      )}

      <Card>
        <CardHead
          title="Участники"
          trailing={
            <span className="tb-num tb-num--muted">
              {paidCount} / {participants.length}
            </span>
          }
        />
        {participants.length === 0 ? (
          <p className="tb-subtitle">Пока никто ничего не заказал.</p>
        ) : (
          <>
            {participants.map((participant) => (
              <Toggle
                key={participant.userId}
                label={participant.displayName}
                pressed={participant.paid}
                onChange={(next) => togglePaid(participant.userId, next)}
                trailing={
                  <span>
                    {participant.ready && order.status === 'ordering' ? (
                      <Badge tone="ordering">готов</Badge>
                    ) : null}{' '}
                    <Money value={participant.totalEur} /> ·{' '}
                    <Weight kg={participant.totalKg} tone="muted" />
                  </span>
                }
              />
            ))}
            <div className="tb-card__head">
              <span className="tb-subtitle">Собрано</span>
              <span>
                <Money value={collected} tone="accent" /> из <Money value={billed} tone="muted" />
              </span>
            </div>
          </>
        )}
      </Card>

      {order.status === 'awaiting_validation' && (
        <Card>
          <CardHead title="Сверка поставки" />
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
              </span>
              <span className="tb-ledger__rail" aria-hidden="true" />
              <span className="tb-ledger__note">нужно {item.expectedQty}</span>
              <Stepper
                value={item.receivedQty}
                max={999}
                onChange={(next) => adjustChecklist(item.id, next - item.receivedQty)}
                label={`${item.brandName} ${item.flavorName} ${gramsLabel(item.grams)}`}
              />
            </div>
          ))}
        </Card>
      )}

      {snapshot && (
        <Card>
          <CardHead title="Слепок для барыги" />
          <Snapshot
            text={snapshot.text}
            onCopy={() => navigator.clipboard?.writeText(snapshot.text)}
          />
          {snapshot.table.map((row, index) => (
            <LedgerRow
              key={`${row.brand}-${row.flavor}-${row.weight}-${index}`}
              name={`${row.brand} ${row.flavor}`}
              meta={row.weight}
              quantity={row.quantity}
              amount={row.totalEur}
            />
          ))}
        </Card>
      )}

      <div className="tb-stack">
        {order.status === 'ordering' && (
          <Button variant="primary" block onClick={() => changeStatus('awaiting_validation')}>
            На сверку
          </Button>
        )}
        {order.status === 'awaiting_validation' && (
          <>
            <Button variant="primary" block onClick={startFinishing}>
              Завершить заказ
            </Button>
            <Button variant="secondary" block onClick={() => changeStatus('ordering')}>
              Вернуть в работу
            </Button>
          </>
        )}
        {(order.status === 'ordering' || order.status === 'awaiting_validation') && (
          <Button variant="destructive" block onClick={() => changeStatus('rejected')}>
            Отменить заказ
          </Button>
        )}
      </div>
    </div>
  );
}
