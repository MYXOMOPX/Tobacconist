import { useEffect, useState } from 'react';
import { api } from './apiClient';
import type { Me } from './types';

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

  return <p data-testid="shell">{me.role === 'admin' ? 'Админ-панель' : 'Мой заказ'}</p>;
}
