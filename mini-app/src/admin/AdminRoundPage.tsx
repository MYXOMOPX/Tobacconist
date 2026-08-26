import { useEffect, useState, useCallback } from 'react';
import { api } from '../apiClient';

type Round = { id: number; vendorId: number; vendorName: string; status: 'open' | 'closed'; openedAt: string; closedAt: string | null };
type Vendor = { id: number; name: string; archived: boolean };
type TableRow = { brand: string; flavor: string; weight: string; quantity: number; totalEur: number };
type Snapshot = { text: string; table: TableRow[] };
type ChecklistItem = { id: number; brandName: string; flavorName: string; grams: number; expectedQty: number; receivedQty: number };
type Payment = { userId: number; displayName: string; paid: boolean };

export function AdminRoundPage() {
  const [round, setRound] = useState<Round | null | undefined>(undefined);
  const [vendors, setVendors] = useState<Vendor[]>([]);
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [checklist, setChecklist] = useState<ChecklistItem[]>([]);
  const [payments, setPayments] = useState<Payment[]>([]);

  const loadRound = useCallback(async () => {
    const active = await api.get<Round | null>('/rounds/active');
    setRound(active);
  }, []);

  useEffect(() => {
    loadRound();
    api.get<Vendor[]>('/admin/vendors').then(setVendors);
  }, [loadRound]);

  useEffect(() => {
    if (!round) {
      setSnapshot(null);
      setChecklist([]);
      setPayments([]);
      return;
    }
    api.get<Snapshot>(`/rounds/${round.id}/snapshot`).then(setSnapshot);
    api.get<Payment[]>(`/rounds/${round.id}/payments`).then(setPayments);
    if (round.status === 'closed') {
      api.get<ChecklistItem[]>(`/rounds/${round.id}/checklist`).then(setChecklist);
    }
  }, [round]);

  async function startRound(vendorId: number) {
    await api.post('/rounds', { vendorId });
    await loadRound();
  }

  async function closeRound() {
    if (!round) return;
    await api.post(`/rounds/${round.id}/close`);
    await loadRound();
  }

  async function reopenRound() {
    if (!round) return;
    await api.post(`/rounds/${round.id}/reopen`);
    await loadRound();
  }

  async function adjustChecklist(itemId: number, delta: number) {
    if (!round) return;
    await api.post<ChecklistItem>(`/rounds/${round.id}/checklist/${itemId}/adjust`, { delta });
    setChecklist(await api.get<ChecklistItem[]>(`/rounds/${round.id}/checklist`));
  }

  async function togglePaid(userId: number, paid: boolean) {
    if (!round) return;
    await api.post(`/rounds/${round.id}/payments/${userId}`, { paid });
    setPayments(await api.get<Payment[]>(`/rounds/${round.id}/payments`));
  }

  async function exportSnapshot() {
    if (!round) return;
    await api.post(`/rounds/${round.id}/snapshot/export`);
  }

  if (round === undefined) return <p>Загрузка...</p>;

  if (round === null) {
    return (
      <section>
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
          {payments.map((p) => (
            <li key={p.userId}>
              <label>
                <input
                  type="checkbox"
                  checked={p.paid}
                  onChange={(e) => togglePaid(p.userId, e.target.checked)}
                />
                {p.displayName}
              </label>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
