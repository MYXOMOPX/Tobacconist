import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AdminOrderPage } from './AdminOrderPage';
import { api } from '../apiClient';

vi.mock('../apiClient', () => ({ api: { get: vi.fn(), post: vi.fn(), put: vi.fn() } }));

function order(status: string) {
  return { id: 5, vendorId: 1, vendorName: 'Vasya', status, createdAt: '', statusChangedAt: '' };
}

const summaries = [
  { userId: 2, displayName: 'Friend', items: [], totalKg: 0.75, totalEur: 15, paid: false, ready: true },
  { userId: 3, displayName: 'Kirill', items: [], totalKg: 0.25, totalEur: 5, paid: true, ready: false },
];

const snapshot = {
  text: 'DarkSide - CyberKiwi - 250g - x3',
  table: [{ brand: 'DarkSide', flavor: 'CyberKiwi', weight: '250g', quantity: 3, totalEur: 15 }],
};

const checklist = [
  {
    id: 11,
    brandId: 1,
    brandName: 'DarkSide',
    flavorId: 1,
    flavorName: 'CyberKiwi',
    weightId: 1,
    grams: 250,
    expectedQty: 3,
    receivedQty: 1,
  },
];

const discrepancy = {
  brandId: 1,
  brandName: 'DarkSide',
  flavorId: 1,
  flavorName: 'CyberKiwi',
  weightId: 1,
  grams: 250,
  expectedQty: 3,
  receivedQty: 1,
  participants: [
    { orderItemId: 100, userId: 2, displayName: 'Friend', quantity: 2, proposedDeliveredQty: 2 },
    { orderItemId: 101, userId: 3, displayName: 'Kirill', quantity: 1, proposedDeliveredQty: 1 },
  ],
};

function mockApi(status: string, extra: Record<string, unknown> = {}) {
  vi.mocked(api.get).mockImplementation(async (path: string) => {
    if (path === '/orders/5') return order(status);
    if (path === '/orders/5/summaries') return summaries;
    if (path === '/orders/5/snapshot') return snapshot;
    if (path === '/orders/5/checklist') return checklist;
    if (path === '/orders/5/discrepancies') return extra.discrepancies ?? [];
    return [];
  });
  vi.mocked(api.post).mockResolvedValue({});
}

describe('AdminOrderPage — collecting', () => {
  it('shows who is ready and how much money is in', async () => {
    mockApi('ordering');
    render(<AdminOrderPage orderId={5} onBack={vi.fn()} />);

    const friend = await screen.findByRole('button', { name: /Friend/ });
    expect(friend).toHaveTextContent('готов');
    expect(friend).toHaveTextContent('15.00');
    expect(screen.getByText('Собрано').closest('.tb-card__head')).toHaveTextContent('5.00');
  });

  it('closes collection after confirming, then opens the checklist screen', async () => {
    mockApi('ordering');
    const user = userEvent.setup();
    render(<AdminOrderPage orderId={5} onBack={vi.fn()} />);

    await user.click(await screen.findByRole('button', { name: 'Сверка' }));
    // Confirmation warns that the collection closes for good.
    expect(
      await screen.findByText(/Участники больше не смогут менять свои заказы/)
    ).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Закрыть сбор' }));
    expect(api.post).toHaveBeenCalledWith('/orders/5/status', { status: 'awaiting_validation' });
    expect(await screen.findByText('Сверка поставки')).toBeInTheDocument();
  });

  it('marks a participant as paid', async () => {
    mockApi('ordering');
    const user = userEvent.setup();
    render(<AdminOrderPage orderId={5} onBack={vi.fn()} />);

    await user.click(await screen.findByRole('button', { name: /Friend/ }));
    await waitFor(() =>
      expect(api.post).toHaveBeenCalledWith('/orders/5/payments/2', { paid: true })
    );
  });

  it('has no checklist while the order is still collecting', async () => {
    mockApi('ordering');
    render(<AdminOrderPage orderId={5} onBack={vi.fn()} />);
    await screen.findByText('Участники');
    expect(screen.queryByText('Сверка поставки')).not.toBeInTheDocument();
  });
});

describe('AdminOrderPage — on validation', () => {
  it('opens the checklist screen without touching the status, and can come back', async () => {
    mockApi('awaiting_validation');
    const user = userEvent.setup();
    render(<AdminOrderPage orderId={5} onBack={vi.fn()} />);

    // No confirmation dialog here — the status is already awaiting_validation.
    await user.click(await screen.findByRole('button', { name: 'Сверка' }));
    expect(await screen.findByText('Сверка поставки')).toBeInTheDocument();
    expect(screen.queryByText('Закрыть сбор и перейти к сверке?')).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: '← К заказу' }));
    expect(await screen.findByText('Vasya')).toBeInTheDocument();
  });

  it('finishes straight away when the delivery matched', async () => {
    mockApi('awaiting_validation', { discrepancies: [] });
    const user = userEvent.setup();
    render(<AdminOrderPage orderId={5} onBack={vi.fn()} />);

    await user.click(await screen.findByRole('button', { name: 'Сверка' }));
    await user.click(await screen.findByRole('button', { name: 'Завершить заказ' }));

    await waitFor(() =>
      expect(api.post).toHaveBeenCalledWith('/orders/5/finish', { allocations: [] })
    );
  });

  it('asks who loses the missing pack, and refuses to finish until it adds up', async () => {
    mockApi('awaiting_validation', { discrepancies: [discrepancy] });
    const user = userEvent.setup();
    render(<AdminOrderPage orderId={5} onBack={vi.fn()} />);

    await user.click(await screen.findByRole('button', { name: 'Сверка' }));
    await user.click(await screen.findByRole('button', { name: 'Завершить заказ' }));

    expect(await screen.findByText('Что кому досталось')).toBeInTheDocument();
    expect(screen.getByText('DarkSide CyberKiwi, 250г')).toBeInTheDocument();
    // Everyone is pre-filled with their own order: 2 + 1 against 1 delivered.
    expect(screen.getByText('снять 2')).toBeInTheDocument();

    const finish = screen.getByRole('button', { name: 'Завершить заказ' });
    expect(finish).toBeDisabled();

    await user.click(screen.getByRole('button', { name: /Убрать одну пачку: Friend, досталось/ }));
    expect(screen.getByText('снять 1')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /Убрать одну пачку: Friend, досталось/ }));

    expect(screen.getByText('распределено')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Завершить заказ' }));

    await waitFor(() =>
      expect(api.post).toHaveBeenCalledWith('/orders/5/finish', {
        allocations: [
          { orderItemId: 100, deliveredQty: 0 },
          { orderItemId: 101, deliveredQty: 1 },
        ],
      })
    );
  });

  it('returns the order to collecting', async () => {
    mockApi('awaiting_validation');
    const user = userEvent.setup();
    render(<AdminOrderPage orderId={5} onBack={vi.fn()} />);

    await user.click(await screen.findByRole('button', { name: 'Вернуть в работу' }));
    expect(api.post).toHaveBeenCalledWith('/orders/5/status', { status: 'ordering' });
  });

  it('cancels the order', async () => {
    mockApi('awaiting_validation');
    const user = userEvent.setup();
    render(<AdminOrderPage orderId={5} onBack={vi.fn()} />);

    await user.click(await screen.findByRole('button', { name: 'Отменить заказ' }));
    expect(api.post).toHaveBeenCalledWith('/orders/5/status', { status: 'rejected' });
  });
});

describe('AdminOrderPage — finished', () => {
  it('offers no status actions once the order is done', async () => {
    mockApi('done');
    render(<AdminOrderPage orderId={5} onBack={vi.fn()} />);

    await screen.findByText('Участники');
    expect(screen.queryByRole('button', { name: 'Завершить заказ' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Вернуть в работу' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Отменить заказ' })).not.toBeInTheDocument();
  });

  it('still shows the snapshot for reference', async () => {
    mockApi('done');
    render(<AdminOrderPage orderId={5} onBack={vi.fn()} />);
    expect(await screen.findByText(/CyberKiwi - 250g - x3/)).toBeInTheDocument();
  });
});
