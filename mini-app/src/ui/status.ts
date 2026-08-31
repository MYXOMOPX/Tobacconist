/**
 * Order status vocabulary. Labels and badge styling live together so the
 * "filled while alive, outlined once over" rule cannot drift screen to screen.
 */

export type OrderStatus = 'ordering' | 'awaiting_validation' | 'done' | 'rejected';

export const ORDER_STATUS_LABEL: Record<OrderStatus, string> = {
  ordering: 'Сбор заказов',
  awaiting_validation: 'На сверке',
  done: 'Завершён',
  rejected: 'Отменён',
};

const BADGE_MODIFIER: Record<OrderStatus, string> = {
  ordering: 'ordering',
  awaiting_validation: 'awaiting',
  done: 'done',
  rejected: 'rejected',
};

/** An order is active while the admin can still act on it (spec §5). */
export function isActiveOrderStatus(status: OrderStatus): boolean {
  return status === 'ordering' || status === 'awaiting_validation';
}

export function statusBadgeModifier(status: OrderStatus): string {
  return BADGE_MODIFIER[status];
}
