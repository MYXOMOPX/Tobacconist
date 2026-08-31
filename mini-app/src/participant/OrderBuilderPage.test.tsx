import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { OrderBuilderPage } from './OrderBuilderPage';
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

function mockApi(mineResponse: Record<string, unknown>, assortment = [FLAVOR]) {
  vi.mocked(api.get).mockImplementation(async (path: string) => {
    if (path === '/orders/5/assortment') return assortment;
    if (path === '/orders/5/mine') return mineResponse;
    return [];
  });
}

describe('OrderBuilderPage', () => {
  it('renders assortment with the quantity already ordered and saves a change', async () => {
    mockApi(mine());
    vi.mocked(api.put).mockResolvedValue({});

    const user = userEvent.setup();
    render(<OrderBuilderPage orderId={5} onBack={vi.fn()} />);

    const stepper = await screen.findByRole('group', { name: 'CyberKiwi 250г' });
    expect(stepper).toHaveTextContent('2');

    await user.click(screen.getByRole('button', { name: /Добавить одну пачку: CyberKiwi 250г/ }));

    await waitFor(() =>
      expect(api.put).toHaveBeenCalledWith('/orders/5/items', {
        brandId: 1,
        flavorId: 1,
        weightId: 1,
        quantity: 3,
      })
    );

    const line = (await screen.findByText('DarkSide CyberKiwi')).closest('.tb-ledger');
    expect(line).toHaveTextContent('10.50');
  });

  it('locks the steppers once the order is on validation', async () => {
    mockApi(mine({ order: order('awaiting_validation') }));

    render(<OrderBuilderPage orderId={5} onBack={vi.fn()} />);

    expect(await screen.findByText(/Добавление позиций закрыто/)).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: /Добавить одну пачку: CyberKiwi 250г/ })
    ).toBeDisabled();
    expect(screen.queryByRole('button', { name: 'Я готов' })).not.toBeInTheDocument();
  });

  it('marks the participant ready and offers to take it back', async () => {
    mockApi(mine());
    vi.mocked(api.post).mockResolvedValue({});

    const user = userEvent.setup();
    render(<OrderBuilderPage orderId={5} onBack={vi.fn()} />);

    await user.click(await screen.findByRole('button', { name: 'Я готов' }));
    expect(api.post).toHaveBeenCalledWith('/orders/5/ready', { ready: true });

    mockApi(mine({ ready: true }));
    render(<OrderBuilderPage orderId={5} onBack={vi.fn()} />);
    expect(await screen.findByRole('button', { name: 'Ещё выбираю' })).toBeInTheDocument();
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
      }),
      [{ ...FLAVOR, flavorId: 2, flavorName: 'Bananapapa' }]
    );

    render(<OrderBuilderPage orderId={5} onBack={vi.fn()} />);

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

    render(<OrderBuilderPage orderId={5} onBack={vi.fn()} />);

    const line = (await screen.findByText('DarkSide CyberKiwi')).closest('.tb-ledger');
    expect(line).toHaveTextContent('досталось 1');
  });

  it('shows the error message when saving a quantity fails', async () => {
    mockApi(mine({ items: [], totalKg: 0, totalEur: 0 }));
    vi.mocked(api.put).mockRejectedValue(new Error('no price set for this brand yet'));

    const user = userEvent.setup();
    render(<OrderBuilderPage orderId={5} onBack={vi.fn()} />);

    await user.click(
      await screen.findByRole('button', { name: /Добавить одну пачку: CyberKiwi 250г/ })
    );

    expect(await screen.findByRole('alert')).toHaveTextContent('no price set for this brand yet');
  });

  it('offers a way back to the list of orders', async () => {
    mockApi(mine());
    const onBack = vi.fn();
    const user = userEvent.setup();
    render(<OrderBuilderPage orderId={5} onBack={onBack} />);

    await user.click(await screen.findByRole('button', { name: '← Все заказы' }));
    expect(onBack).toHaveBeenCalled();
  });
});
