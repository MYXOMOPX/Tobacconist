import { useEffect, useState } from 'react';
import { api } from './apiClient';
import type { Me } from './types';
import { AdminCatalogPage } from './admin/AdminCatalogPage';

export function App() {
  const [me, setMe] = useState<Me | null>(null);
  const [error, setError] = useState<string | null>(null);

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
        <AdminCatalogPage />
      </div>
    );
  }

  return <p data-testid="shell">Мой заказ</p>;
}
