import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MyOrderPage } from './MyOrderPage';
import { api } from '../apiClient';

vi.mock('../apiClient', () => ({ api: { get: vi.fn(), post: vi.fn(), put: vi.fn() } }));

const FLAVOR = {
  brandId: 1,
  brandName: 'DarkSide',
  flavorId: 1,
  flavorName: 'CyberKiwi',
  weightId: 1,
  grams: 250,
  available: true,
};

function order(status: string) {
  return { id: 5, vendorId: 1, vendorName: 'Vasya', status, createdAt: '', statusChangedAt: '' };
}

function mine(overrides: Record<string, unknown> = {}) {
  return {
    order: order('ordering'),
    items: [{ ...FLAVOR, quantity: 2, deliveredQty: null, totalEur: 10.5 }],
    totalKg: 0.5,
    totalEur: 10.5,
    ready: false,
    paid: false,
    hasUnavailableItems: false,
    ...overrides,
  };
}

function mockApi(mineResponse: Record<string, unknown>) {
  vi.mocked(api.get).mockImplementation(async (path: string) => {
    if (path === '/orders/5/mine') return mineResponse;
    return [];
  });
}

describe('MyOrderPage', () => {
  it('renders order lines with amounts and the running totals', async () => {
    mockApi(mine());

    render(<MyOrderPage orderId={5} onBack={vi.fn()} />);

    const line = (await screen.findByText('DarkSide CyberKiwi')).closest('.tb-ledger');
    expect(line).toHaveTextContent('10.50');

    const sticky = document.querySelector('.tb-sticky');
    expect(sticky).toHaveTextContent('10.50');
    expect(sticky).toHaveTextContent('0.50');
  });

  it('marks the participant ready and offers to take it back', async () => {
    mockApi(mine());
    vi.mocked(api.post).mockResolvedValue({});

    const user = userEvent.setup();
    render(<MyOrderPage orderId={5} onBack={vi.fn()} />);

    await user.click(await screen.findByRole('button', { name: 'Готово' }));
    await waitFor(() =>
      expect(api.post).toHaveBeenCalledWith('/orders/5/ready', { ready: true })
    );

    mockApi(mine({ ready: true }));
    render(<MyOrderPage orderId={5} onBack={vi.fn()} />);
    expect(await screen.findByRole('button', { name: 'Не готово' })).toBeInTheDocument();
  });

  it('hides the readiness button once the order is locked for validation', async () => {
    mockApi(mine({ order: order('awaiting_validation') }));

    render(<MyOrderPage orderId={5} onBack={vi.fn()} />);

    expect(await screen.findByText(/Добавление позиций закрыто/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Готово' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Не готово' })).not.toBeInTheDocument();
  });

  it('offers a way back to picking tobacco', async () => {
    mockApi(mine());
    const onBack = vi.fn();
    const user = userEvent.setup();
    render(<MyOrderPage orderId={5} onBack={onBack} />);

    await user.click(await screen.findByRole('button', { name: '← К выбору' }));
    expect(onBack).toHaveBeenCalled();
  });

  it('marks the specific order line that is no longer available', async () => {
    mockApi(
      mine({
        items: [
          { ...FLAVOR, quantity: 2, deliveredQty: null, totalEur: 10, available: false },
          {
            ...FLAVOR,
            flavorId: 2,
            flavorName: 'Bananapapa',
            quantity: 1,
            deliveredQty: null,
            totalEur: 5,
            available: true,
          },
        ],
        hasUnavailableItems: true,
      })
    );

    render(<MyOrderPage orderId={5} onBack={vi.fn()} />);

    const droppedLine = (await screen.findByText('DarkSide CyberKiwi')).closest('.tb-ledger');
    expect(droppedLine).toHaveClass('tb-ledger--unavailable');
    expect(droppedLine).toHaveTextContent('больше не в наличии');

    const keptLine = screen.getByText('DarkSide Bananapapa').closest('.tb-ledger');
    expect(keptLine).not.toHaveClass('tb-ledger--unavailable');
  });

  it('shows what actually arrived once the delivery was checked', async () => {
    mockApi(
      mine({
        order: order('done'),
        items: [{ ...FLAVOR, quantity: 2, deliveredQty: 1, totalEur: 5.25 }],
      })
    );

    render(<MyOrderPage orderId={5} onBack={vi.fn()} />);

    const line = (await screen.findByText('DarkSide CyberKiwi')).closest('.tb-ledger');
    expect(line).toHaveTextContent('досталось 1');
  });
});
