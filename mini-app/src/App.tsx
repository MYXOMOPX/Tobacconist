import { useEffect, useState } from 'react';
import { api } from './apiClient';
import type { Me } from './types';
import { AdminCatalogPage } from './admin/AdminCatalogPage';
import { AdminOrderPage } from './admin/AdminOrderPage';
import { VendorPage } from './admin/VendorPage';
import { ActiveOrdersPage } from './participant/ActiveOrdersPage';
import { OrderBuilderPage } from './participant/OrderBuilderPage';
import { MyOrderPage } from './participant/MyOrderPage';
import { HistoryPage } from './participant/HistoryPage';
import { orderFromLaunch } from './telegram';
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

export function App() {
  const [me, setMe] = useState<Me | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>('orders');
  const [openOrderId, setOpenOrderId] = useState<number | null>(orderFromLaunch);
  const [openVendorId, setOpenVendorId] = useState<number | null>(null);
  /**
   * The admin orders like everybody else; management is a place they step into
   * deliberately, not the screen they are stuck on.
   */
  const [managing, setManaging] = useState(false);
  /** Picking tobacco and reviewing the composed order are separate screens now. */
  const [viewingMyOrder, setViewingMyOrder] = useState(false);
  /**
   * A closed order opened from the history. It cannot be reopened, but the admin
   * still reads it and still marks who paid (spec §10).
   */
  const [managingClosedId, setManagingClosedId] = useState<number | null>(null);

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

  function backToOrders() {
    setOpenOrderId(null);
    setManaging(false);
    setViewingMyOrder(false);
  }

  return (
    <div data-testid="shell">
      {active === 'orders' &&
        (openOrderId === null ? (
          <ActiveOrdersPage
            isAdmin={isAdmin}
            onOpen={(id) => {
              setOpenOrderId(id);
              setManaging(false);
              setViewingMyOrder(false);
            }}
            onManage={(id) => {
              setOpenOrderId(id);
              setManaging(true);
            }}
          />
        ) : managing && isAdmin ? (
          <AdminOrderPage
            orderId={openOrderId}
            onBack={backToOrders}
            onLeaveManagement={() => setManaging(false)}
          />
        ) : viewingMyOrder ? (
          <MyOrderPage orderId={openOrderId} onBack={() => setViewingMyOrder(false)} />
        ) : (
          <OrderBuilderPage
            orderId={openOrderId}
            onBack={backToOrders}
            onContinue={() => setViewingMyOrder(true)}
            onManage={isAdmin ? () => setManaging(true) : undefined}
          />
        ))}

      {active === 'vendors' &&
        isAdmin &&
        (openVendorId === null ? (
          <AdminCatalogPage onOpenVendor={setOpenVendorId} />
        ) : (
          <VendorPage vendorId={openVendorId} onBack={() => setOpenVendorId(null)} />
        ))}

      {active === 'history' &&
        (managingClosedId !== null && isAdmin ? (
          <AdminOrderPage
            orderId={managingClosedId}
            onBack={() => setManagingClosedId(null)}
            backLabel="История"
          />
        ) : (
          <HistoryPage isAdmin={isAdmin} onManage={setManagingClosedId} />
        ))}

      <TabBar
        items={isAdmin ? ADMIN_TABS : MEMBER_TABS}
        active={active}
        onSelect={(id) => {
          setOpenOrderId(null);
          setOpenVendorId(null);
          setManaging(false);
          setViewingMyOrder(false);
          setManagingClosedId(null);
          setTab(id);
        }}
      />
    </div>
  );
}
