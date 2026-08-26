import { useEffect, useState } from 'react';
import { api } from './apiClient';
import type { Me } from './types';
import { AdminCatalogPage } from './admin/AdminCatalogPage';
import { AdminRoundPage } from './admin/AdminRoundPage';
import { OrderBuilderPage } from './participant/OrderBuilderPage';
import { HistoryPage } from './participant/HistoryPage';

export function App() {
  const [me, setMe] = useState<Me | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [adminTab, setAdminTab] = useState<'round' | 'catalog' | 'history'>('round');
  const [memberTab, setMemberTab] = useState<'order' | 'history'>('order');

  useEffect(() => {
    api
      .get<Me>('/me')
      .then(setMe)
      .catch((e: Error) => setError(e.message));
  }, []);

  if (error) return <p role="alert">{error}</p>;
  if (!me) return <p>Загрузка...</p>;

  if (me.role === 'admin') {
    return (
      <div data-testid="shell">
        <nav>
          <button onClick={() => setAdminTab('round')}>Раунд</button>
          <button onClick={() => setAdminTab('catalog')}>Каталог</button>
          <button onClick={() => setAdminTab('history')}>История</button>
        </nav>
        {adminTab === 'round' && <AdminRoundPage />}
        {adminTab === 'catalog' && <AdminCatalogPage />}
        {adminTab === 'history' && <HistoryPage />}
      </div>
    );
  }

  return (
    <div data-testid="shell">
      <nav>
        <button onClick={() => setMemberTab('order')}>Заказ</button>
        <button onClick={() => setMemberTab('history')}>История</button>
      </nav>
      {memberTab === 'order' ? <OrderBuilderPage /> : <HistoryPage />}
    </div>
  );
}
