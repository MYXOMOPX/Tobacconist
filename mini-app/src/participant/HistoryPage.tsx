import { useEffect, useState } from 'react';
import { api } from '../apiClient';
import { useAction } from '../useAction';

type RoundSummary = {
  id: number;
  vendorId: number;
  vendorName: string;
  status: 'open' | 'closed';
  openedAt: string;
  closedAt: string | null;
};
type RoundDetail = {
  round: RoundSummary;
  items: unknown[];
  totalKg: number;
  totalEur: number;
  paid: boolean;
};

export function HistoryPage() {
  const [rounds, setRounds] = useState<RoundSummary[]>([]);
  const [selected, setSelected] = useState<RoundDetail | null>(null);
  const { error, run } = useAction();

  useEffect(() => {
    run(async () => {
      setRounds(await api.get<RoundSummary[]>('/history'));
    });
  }, [run]);

  function openRound(id: number) {
    return run(async () => {
      setSelected(await api.get<RoundDetail>(`/history/${id}`));
    });
  }

  return (
    <section>
      <h2>История закупок</h2>
      {error && <p role="alert">{error}</p>}
      <ul>
        {rounds.map((r) => (
          <li key={r.id}>
            <button onClick={() => openRound(r.id)}>
              {r.vendorName} — {r.closedAt}
            </button>
          </li>
        ))}
      </ul>
      {selected && (
        <h3>
          {selected.round.vendorName}: {selected.totalKg.toFixed(2)} кг, {selected.totalEur.toFixed(2)} € —{' '}
          {selected.paid ? 'оплачено' : 'не оплачено'}
        </h3>
      )}
    </section>
  );
}
