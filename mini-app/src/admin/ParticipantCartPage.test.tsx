import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ParticipantCartPage } from './ParticipantCartPage';
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

function summary(overrides: Record<string, unknown> = {}) {
  return {
    userId: 2,
    displayName: 'Friend',
    items: [{ ...FLAVOR, quantity: 2, deliveredQty: null, totalEur: 10.5 }],
    totalKg: 0.5,
    totalEur: 10.5,
    paid: false,
    ready: true,
    ...overrides,
  };
}

function mockApi(participant = summary(), assortment = [FLAVOR]) {
  vi.mocked(api.get).mockImplementation(async (path: string) => {
    if (path === '/orders/5/assortment') return assortment;
    if (path === '/orders/5/summaries') return [participant];
    return [];
  });
}

describe('ParticipantCartPage', () => {
  it('renders the assortment with the participant quantity already filled in', async () => {
    mockApi();
    render(
      <ParticipantCartPage
        orderId={5}
        userId={2}
        displayName="Friend"
        status="ordering"
        onBack={vi.fn()}
      />
    );

    const stepper = await screen.findByRole('group', { name: 'CyberKiwi 250г' });
    expect(stepper).toHaveTextContent('2');
    expect(screen.getByText('Friend')).toBeInTheDocument();
  });

  it('sends a stepper change under the participant, not the admin', async () => {
    mockApi();
    vi.mocked(api.put).mockResolvedValue({});
    const user = userEvent.setup();
    render(
      <ParticipantCartPage
        orderId={5}
        userId={2}
        displayName="Friend"
        status="ordering"
        onBack={vi.fn()}
      />
    );

    await user.click(
      await screen.findByRole('button', { name: /Добавить одну пачку: CyberKiwi 250г/ })
    );

    await waitFor(() =>
      expect(api.put).toHaveBeenCalledWith('/orders/5/items', {
        brandId: 1,
        flavorId: 1,
        weightId: 1,
        quantity: 3,
        userId: 2,
      })
    );
  });

  it('marks the participant as paid', async () => {
    mockApi();
    vi.mocked(api.post).mockResolvedValue({});
    const user = userEvent.setup();
    render(
      <ParticipantCartPage
        orderId={5}
        userId={2}
        displayName="Friend"
        status="ordering"
        onBack={vi.fn()}
      />
    );

    await user.click(await screen.findByRole('button', { name: 'Оплачено' }));

    await waitFor(() =>
      expect(api.post).toHaveBeenCalledWith('/orders/5/payments/2', { paid: true })
    );
  });

  it('locks the steppers once the order is done, but payment stays editable', async () => {
    mockApi();
    render(
      <ParticipantCartPage
        orderId={5}
        userId={2}
        displayName="Friend"
        status="done"
        onBack={vi.fn()}
      />
    );

    expect(await screen.findByText(/Заказ закрыт/)).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: /Добавить одну пачку: CyberKiwi 250г/ })
    ).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Оплачено' })).not.toBeDisabled();
  });

  /**
   * The assortment lists only what is in stock, so a line whose flavour is gone
   * has nowhere else to show up — and it still counts towards the total.
   */
  it('shows a line whose flavour is gone, and lets it be taken away', async () => {
    const gone = { ...FLAVOR, flavorId: 9, flavorName: 'Wild Fire', available: false };
    mockApi(
      summary({ items: [{ ...gone, quantity: 1, deliveredQty: null, totalEur: 5 }] }),
      // Sold out, so the vendor assortment no longer carries it at all.
      []
    );
    vi.mocked(api.put).mockResolvedValue({});
    const user = userEvent.setup();
    render(
      <ParticipantCartPage
        orderId={5}
        userId={2}
        displayName="Friend"
        status="ordering"
        onBack={vi.fn()}
      />
    );

    expect(await screen.findByText('Больше не в наличии')).toBeInTheDocument();
    expect(screen.getByText(/Wild Fire/)).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /Убрать одну пачку: DarkSide Wild Fire/ }));

    await waitFor(() =>
      expect(api.put).toHaveBeenCalledWith('/orders/5/items', {
        brandId: 1,
        flavorId: 9,
        weightId: 1,
        quantity: 0,
        userId: 2,
      })
    );
  });

  it('offers a way back to the order', async () => {
    mockApi();
    const onBack = vi.fn();
    const user = userEvent.setup();
    render(
      <ParticipantCartPage
        orderId={5}
        userId={2}
        displayName="Friend"
        status="ordering"
        onBack={onBack}
      />
    );

    await user.click(await screen.findByRole('button', { name: '← К заказу' }));
    expect(onBack).toHaveBeenCalled();
  });
});
