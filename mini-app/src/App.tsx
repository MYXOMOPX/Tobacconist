import { useEffect, useState } from 'react';
import { api } from './apiClient';
import type { Me } from './types';
import { AdminCatalogPage } from './admin/AdminCatalogPage';
import { AdminOrdersPage } from './admin/AdminOrdersPage';
import { AdminOrderPage } from './admin/AdminOrderPage';
import { ActiveOrdersPage } from './participant/ActiveOrdersPage';
import { OrderBuilderPage } from './participant/OrderBuilderPage';
import { HistoryPage } from './participant/HistoryPage';
import { ErrorState, ListSkeleton, TabBar } from './ui';

type Tab = 'orders' | 'vendors' | 'history';

const ADMIN_TABS: { id: Tab; label: string }[] = [
  { id: 'orders', label: 'Заказы' },
  { id: 'vendors', label: 'Барыги' },
  { id: 'history', label: 'История' },
];

const MEMBER_TABS: { id: Tab; label: string }[] = [
  { id: 'orders', label: 'Заказы' },
  { id: 'history', label: 'История' },
];

/**
 * The bot's "🛍 Заказать" button carries the order it announced, so the person
 * lands on that order instead of guessing which one the message was about.
 */
function orderFromLink(): number | null {
  const raw = new URLSearchParams(window.location.search).get('order');
  const id = Number(raw);
  return raw && Number.isInteger(id) && id > 0 ? id : null;
}

export function App() {
  const [me, setMe] = useState<Me | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>('orders');
  const [openOrderId, setOpenOrderId] = useState<number | null>(orderFromLink);

  function loadMe() {
    setError(null);
    api
      .get<Me>('/me')
      .then(setMe)
      .catch((e: Error) => setError(e.message));
  }

  useEffect(loadMe, []);

  if (error) {
    return (
      <div className="tb-page">
        <ErrorState text={error} onRetry={loadMe} />
      </div>
    );
  }

  if (!me) {
    return (
      <div className="tb-page">
        <ListSkeleton />
      </div>
    );
  }

  const isAdmin = me.role === 'admin';
  // A member never sees the vendors tab, so a stale selection would leave them
  // staring at nothing.
  const active: Tab = !isAdmin && tab === 'vendors' ? 'orders' : tab;

  function openOrders() {
    setOpenOrderId(null);
    setTab('orders');
  }

  return (
    <div data-testid="shell">
      {active === 'orders' &&
        (isAdmin ? (
          openOrderId === null ? (
            <AdminOrdersPage onOpen={setOpenOrderId} />
          ) : (
            <AdminOrderPage orderId={openOrderId} onBack={openOrders} />
          )
        ) : openOrderId === null ? (
          <ActiveOrdersPage onOpen={setOpenOrderId} />
        ) : (
          <OrderBuilderPage orderId={openOrderId} onBack={openOrders} />
        ))}
      {active === 'vendors' && isAdmin && <AdminCatalogPage />}
      {active === 'history' && <HistoryPage />}

      <TabBar
        items={isAdmin ? ADMIN_TABS : MEMBER_TABS}
        active={active}
        onSelect={(id) => {
          setOpenOrderId(null);
          setTab(id);
        }}
      />
    </div>
  );
}
