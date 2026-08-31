import { useEffect, useState } from 'react';
import { api } from '../apiClient';
import { useAction } from '../useAction';
import type { OrderDto, Vendor } from '../types';
import {
  Banner,
  Button,
  EmptyState,
  ListSkeleton,
  Row,
  Sheet,
  StatusBadge,
} from '../ui';

/** Spec §5: the admin sees every collecting order and opens new ones per vendor. */
export function AdminOrdersPage({ onOpen }: { onOpen: (orderId: number) => void }) {
  const [orders, setOrders] = useState<OrderDto[]>([]);
  const [vendors, setVendors] = useState<Vendor[]>([]);
  const [picking, setPicking] = useState(false);
  const [loading, setLoading] = useState(true);
  const { error, run } = useAction();

  function load() {
    return run(async () => {
      setOrders(await api.get<OrderDto[]>('/orders'));
      setVendors(await api.get<Vendor[]>('/admin/vendors'));
    });
  }

  useEffect(() => {
    load().finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [run]);

  function startOrder(vendorId: number) {
    return run(async () => {
      const created = await api.post<OrderDto>('/orders', { vendorId });
      setPicking(false);
      onOpen(created.id);
    });
  }

  const activeByVendor = new Map(orders.map((order) => [order.vendorId, order]));
  const available = vendors.filter((vendor) => !vendor.archived);

  if (loading) {
    return (
      <div className="tb-page">
        <ListSkeleton />
      </div>
    );
  }

  return (
    <div className="tb-page">
      <h1 className="tb-title">Активные заказы</h1>
      {error && <Banner tone="danger">{error}</Banner>}

      {orders.length === 0 ? (
        <EmptyState
          title="Активных заказов нет"
          text="Открой заказ у барыги — участники сразу увидят его в своём списке."
        />
      ) : (
        <div className="tb-stack">
          {orders.map((order) => (
            <Row
              key={order.id}
              label={order.vendorName}
              note={`Заказ #${order.id}`}
              trailing={<StatusBadge status={order.status} />}
              onClick={() => onOpen(order.id)}
            />
          ))}
        </div>
      )}

      <Button variant="primary" block onClick={() => setPicking(true)}>
        Новый заказ
      </Button>

      <Sheet open={picking} title="У кого закупаемся?" onClose={() => setPicking(false)}>
        {available.length === 0 ? (
          <EmptyState title="Барыг ещё нет" text="Заведи барыгу на вкладке «Барыги»." />
        ) : (
          available.map((vendor) => {
            const active = activeByVendor.get(vendor.id);
            return (
              <Row
                key={vendor.id}
                label={vendor.name}
                note={active ? 'уже есть активный заказ' : undefined}
                trailing={active ? <StatusBadge status={active.status} /> : undefined}
                disabled={Boolean(active)}
                onClick={() => startOrder(vendor.id)}
              />
            );
          })
        )}
      </Sheet>
    </div>
  );
}
