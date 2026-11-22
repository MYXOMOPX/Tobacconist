import { useCallback, useEffect, useState } from 'react';
import { api } from '../apiClient';
import { useAction } from '../useAction';
import type { Discrepancy, OrderDto, ParticipantSummary, SnapshotDto } from '../types';
import {
  Badge,
  Banner,
  Button,
  Card,
  CardHead,
  ConfirmDialog,
  LedgerRow,
  ListSkeleton,
  Money,
  Row,
  Snapshot,
  StatusBadge,
  Stepper,
  Weight,
  gramsLabel,
} from '../ui';
import { ChecklistPage } from './ChecklistPage';
import { ParticipantCartPage } from './ParticipantCartPage';
import { OrderTablesPage } from './OrderTablesPage';

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
  backLabel = 'Все заказы',
}: {
  orderId: number;
  onBack: () => void;
  /** Back to ordering as a participant: the admin buys tobacco too. */
  onLeaveManagement?: () => void;
  /** Where back goes — the same screen is reached from the history too. */
  backLabel?: string;
}) {
  const [order, setOrder] = useState<OrderDto | null>(null);
  const [participants, setParticipants] = useState<ParticipantSummary[]>([]);
  const [snapshot, setSnapshot] = useState<SnapshotDto | null>(null);
  const [discrepancies, setDiscrepancies] = useState<Discrepancy[]>([]);
  const [allocations, setAllocations] = useState<Allocations>({});
  const [distributing, setDistributing] = useState(false);
  const [checking, setChecking] = useState(false);
  const [cartUserId, setCartUserId] = useState<number | null>(null);
  const [showTables, setShowTables] = useState(false);
  const [confirmingClose, setConfirmingClose] = useState(false);
  const [loading, setLoading] = useState(true);
  const { error, run } = useAction();

  const reload = useCallback(async () => {
    const loaded = await api.get<OrderDto>(`/orders/${orderId}`);
    setOrder(loaded);
    setParticipants(await api.get<ParticipantSummary[]>(`/orders/${orderId}/summaries`));
    setSnapshot(await api.get<SnapshotDto>(`/orders/${orderId}/snapshot`));
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

  /** Closing the collection generates the checklist server-side; jump straight into it. */
  function closeCollectionAndCheck() {
    return run(async () => {
      await api.post(`/orders/${orderId}/status`, { status: 'awaiting_validation' });
      setConfirmingClose(false);
      await reload();
      setChecking(true);
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
      setChecking(false);
      setDistributing(true);
    });
  }

  function finish(payload: { orderItemId: number; deliveredQty: number }[]) {
    return run(async () => {
      await api.post(`/orders/${orderId}/finish`, { allocations: payload });
      setDistributing(false);
      setChecking(false);
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

  // Spec §11 screen 7: the admin steps into one participant's basket to fix it up.
  if (cartUserId !== null) {
    const participant = participants.find((p) => p.userId === cartUserId);
    return (
      <ParticipantCartPage
        orderId={orderId}
        userId={cartUserId}
        displayName={participant?.displayName ?? ''}
        status={order.status}
        onBack={() => {
          setCartUserId(null);
          // Whatever changed inside the cart — quantities, payment — has to show up here too.
          run(reload);
        }}
      />
    );
  }

  if (showTables) {
    return (
      <OrderTablesPage
        vendorName={order.vendorName}
        participants={participants}
        onBack={() => setShowTables(false)}
      />
    );
  }

  // Reconciliation gets its own screen: it is a chore with a keyboard, not a card (§5).
  if (checking) {
    return (
      <ChecklistPage orderId={orderId} onBack={() => setChecking(false)} onFinish={startFinishing} />
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

  const paidCount = participants.filter((p) => p.paid).length;
  const collected = participants.filter((p) => p.paid).reduce((sum, p) => sum + p.totalEur, 0);
  const billed = participants.reduce((sum, p) => sum + p.totalEur, 0);

  return (
    <div className="tb-page">
      <header className="tb-card__head">
        <div className="tb-row__label">
          <h1 className="tb-title">{order.vendorName}</h1>
          <button type="button" className="tb-btn tb-btn--ghost" onClick={onBack}>
            ← {backLabel}
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
              <Row
                key={participant.userId}
                label={participant.displayName}
                note={
                  participant.paid
                    ? 'оплачено'
                    : participant.ready && order.status === 'ordering'
                      ? 'готов'
                      : undefined
                }
                trailing={
                  <span>
                    <Money value={participant.totalEur} /> ·{' '}
                    <Weight kg={participant.totalKg} tone="muted" />
                  </span>
                }
                onClick={() => setCartUserId(participant.userId)}
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

      <Button block onClick={() => setShowTables(true)}>Таблица заказов</Button>

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
          <Button variant="primary" block onClick={() => setConfirmingClose(true)}>
            Сверка
          </Button>
        )}
        {order.status === 'awaiting_validation' && (
          <>
            <Button variant="primary" block onClick={() => setChecking(true)}>
              Сверка
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

      <ConfirmDialog
        open={confirmingClose}
        title="Закрыть сбор и перейти к сверке?"
        confirmLabel="Закрыть сбор"
        onConfirm={closeCollectionAndCheck}
        onCancel={() => setConfirmingClose(false)}
        body={
          <p className="tb-subtitle">
            Участники больше не смогут менять свои заказы. Дальше — сверка того, что привёз барыга.
          </p>
        }
      />
    </div>
  );
}
