import { useEffect, useState, useCallback } from 'react';
import { api } from '../apiClient';
import { useAction } from '../useAction';

type Round = { id: number; vendorId: number; vendorName: string; status: 'open' | 'closed'; openedAt: string; closedAt: string | null };
type Vendor = { id: number; name: string; archived: boolean };
type TableRow = { brand: string; flavor: string; weight: string; quantity: number; totalEur: number };
type Snapshot = { text: string; table: TableRow[] };
type ChecklistItem = { id: number; brandName: string; flavorName: string; grams: number; expectedQty: number; receivedQty: number };
type ParticipantSummary = { userId: number; displayName: string; totalKg: number; totalEur: number; paid: boolean };

export function AdminRoundPage() {
  const [round, setRound] = useState<Round | null | undefined>(undefined);
  const [vendors, setVendors] = useState<Vendor[]>([]);
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [checklist, setChecklist] = useState<ChecklistItem[]>([]);
  const [participants, setParticipants] = useState<ParticipantSummary[]>([]);
  const { error, run } = useAction();

  /** Loads a specific round by id — works for closed rounds too, unlike /rounds/active. */
  const loadRoundById = useCallback(async (roundId: number) => {
    setRound(await api.get<Round>(`/rounds/${roundId}`));
  }, []);

  const loadInitialRound = useCallback(async () => {
    const active = await api.get<Round | null>('/rounds/active');
    if (active) {
      setRound(active);
      return;
    }
    // No open round: fall back to the admin's most recent closed round so the
    // checklist / snapshot / payments for it stay reachable.
    const history = await api.get<Round[]>('/history');
    const closed = history.filter((r) => r.status === 'closed');
    if (closed.length === 0) {
      setRound(null);
      return;
    }
    const mostRecent = closed.reduce((a, b) => ((b.closedAt ?? '') > (a.closedAt ?? '') ? b : a));
    setRound(await api.get<Round>(`/rounds/${mostRecent.id}`));
  }, []);

  useEffect(() => {
    run(async () => {
      await loadInitialRound();
      setVendors(await api.get<Vendor[]>('/admin/vendors'));
    });
  }, [loadInitialRound, run]);

  useEffect(() => {
    if (!round) {
      setSnapshot(null);
      setChecklist([]);
      setParticipants([]);
      return;
    }
    const roundId = round.id;
    run(async () => {
      setSnapshot(await api.get<Snapshot>(`/rounds/${roundId}/snapshot`));
      setParticipants(await api.get<ParticipantSummary[]>(`/rounds/${roundId}/summaries`));
      if (round.status === 'closed') {
        setChecklist(await api.get<ChecklistItem[]>(`/rounds/${roundId}/checklist`));
      }
    });
  }, [round, run]);

  function startRound(vendorId: number) {
    return run(async () => {
      const created = await api.post<Round>('/rounds', { vendorId });
      await loadRoundById(created.id);
    });
  }

  function closeRound() {
    if (!round) return;
    const roundId = round.id;
    return run(async () => {
      await api.post(`/rounds/${roundId}/close`);
      // Re-fetch by id, not /rounds/active — the round is no longer "active".
      await loadRoundById(roundId);
    });
  }

  function reopenRound() {
    if (!round) return;
    const roundId = round.id;
    return run(async () => {
      await api.post(`/rounds/${roundId}/reopen`);
      await loadRoundById(roundId);
    });
  }

  function adjustChecklist(itemId: number, delta: number) {
    if (!round) return;
    const roundId = round.id;
    return run(async () => {
      await api.post<ChecklistItem>(`/rounds/${roundId}/checklist/${itemId}/adjust`, { delta });
      setChecklist(await api.get<ChecklistItem[]>(`/rounds/${roundId}/checklist`));
    });
  }

  function togglePaid(userId: number, paid: boolean) {
    if (!round) return;
    const roundId = round.id;
    return run(async () => {
      await api.post(`/rounds/${roundId}/payments/${userId}`, { paid });
      setParticipants(await api.get<ParticipantSummary[]>(`/rounds/${roundId}/summaries`));
    });
  }

  function exportSnapshot() {
    if (!round) return;
    const roundId = round.id;
    return run(async () => {
      await api.post(`/rounds/${roundId}/snapshot/export`);
    });
  }

  if (round === undefined) {
    return (
      <section>
        {error && <p role="alert">{error}</p>}
        <p>Загрузка...</p>
      </section>
    );
  }

  if (round === null) {
    return (
      <section>
        {error && <p role="alert">{error}</p>}
        <h2>Начать раунд</h2>
        <ul>
          {vendors
            .filter((v) => !v.archived)
            .map((v) => (
              <li key={v.id}>
                <button onClick={() => startRound(v.id)}>{v.name}</button>
              </li>
            ))}
        </ul>
      </section>
    );
  }

  return (
    <section>
      {error && <p role="alert">{error}</p>}
      <h2>
        Раунд #{round.id} — {round.vendorName} ({round.status})
      </h2>
      {round.status === 'open' ? (
        <button onClick={closeRound}>Закрыть раунд</button>
      ) : (
        <button onClick={reopenRound}>Переоткрыть раунд</button>
      )}

      {snapshot && (
        <div>
          <h3>Слепок</h3>
          <pre>{snapshot.text}</pre>
          <button onClick={() => navigator.clipboard?.writeText(snapshot.text)}>Скопировать</button>
          <button onClick={exportSnapshot}>Выгрузить в Telegram</button>
          <table>
            <thead>
              <tr>
                <th>Бренд</th>
                <th>Вкус</th>
                <th>Граммовка</th>
                <th>Кол-во</th>
                <th>Сумма</th>
              </tr>
            </thead>
            <tbody>
              {snapshot.table.map((row, i) => (
                <tr key={i}>
                  <td>{row.brand}</td>
                  <td>{row.flavor}</td>
                  <td>{row.weight}</td>
                  <td>{row.quantity}</td>
                  <td>{row.totalEur}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {round.status === 'closed' && (
        <div>
          <h3>Сверка поставки</h3>
          <ul>
            {checklist.map((item) => (
              <li key={item.id}>
                {item.brandName} - {item.flavorName} - {item.grams}г: нужно {item.expectedQty}, привезли{' '}
                {item.receivedQty}
                <button onClick={() => adjustChecklist(item.id, -1)}>-</button>
                <button onClick={() => adjustChecklist(item.id, 1)}>+</button>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div>
        <h3>Оплаты</h3>
        <ul>
          {participants.map((p) => (
            <li key={p.userId}>
              <label>
                <input
                  type="checkbox"
                  checked={p.paid}
                  onChange={(e) => togglePaid(p.userId, e.target.checked)}
                />
                {p.displayName}
              </label>{' '}
              — {p.totalKg.toFixed(2)} кг, {p.totalEur.toFixed(2)} €
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
