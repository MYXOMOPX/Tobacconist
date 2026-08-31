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
    render(<OrderBuilderPage orderId={5} onBack={vi.fn()} onContinue={vi.fn()} />);

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
  });

  it('locks the steppers once the order is on validation, but still offers to continue', async () => {
    mockApi(mine({ order: order('awaiting_validation') }));

    render(<OrderBuilderPage orderId={5} onBack={vi.fn()} onContinue={vi.fn()} />);

    expect(await screen.findByText(/Добавление позиций закрыто/)).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: /Добавить одну пачку: CyberKiwi 250г/ })
    ).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Продолжить' })).toBeInTheDocument();
  });

  it('opens the composed order on "Продолжить"', async () => {
    mockApi(mine());
    const onContinue = vi.fn();
    const user = userEvent.setup();
    render(<OrderBuilderPage orderId={5} onBack={vi.fn()} onContinue={onContinue} />);

    await user.click(await screen.findByRole('button', { name: 'Продолжить' }));
    expect(onContinue).toHaveBeenCalled();
  });

  it('shows the error message when saving a quantity fails', async () => {
    mockApi(mine({ items: [], totalKg: 0, totalEur: 0 }));
    vi.mocked(api.put).mockRejectedValue(new Error('no price set for this brand yet'));

    const user = userEvent.setup();
    render(<OrderBuilderPage orderId={5} onBack={vi.fn()} onContinue={vi.fn()} />);

    await user.click(
      await screen.findByRole('button', { name: /Добавить одну пачку: CyberKiwi 250г/ })
    );

    expect(await screen.findByRole('alert')).toHaveTextContent('no price set for this brand yet');
  });

  it('offers a way back to the list of orders', async () => {
    mockApi(mine());
    const onBack = vi.fn();
    const user = userEvent.setup();
    render(<OrderBuilderPage orderId={5} onBack={onBack} onContinue={vi.fn()} />);

    await user.click(await screen.findByRole('button', { name: '← Все заказы' }));
    expect(onBack).toHaveBeenCalled();
  });
});
