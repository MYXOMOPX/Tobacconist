import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { OrderBuilderPage } from './OrderBuilderPage';
import { api } from '../apiClient';

vi.mock('../apiClient', () => ({ api: { get: vi.fn(), post: vi.fn(), put: vi.fn() } }));

describe('OrderBuilderPage', () => {
  it('shows a message when there is no active round', async () => {
    vi.mocked(api.get).mockImplementation(async (path: string) => {
      if (path === '/orders/assortment') return [];
      if (path === '/orders/mine') return { round: null, items: [], totalKg: 0, totalEur: 0, hasUnavailableItems: false };
      return [];
    });
    render(<OrderBuilderPage />);
    expect(await screen.findByText(/нет активной закупки/i)).toBeInTheDocument();
  });

  it('renders assortment, prefills existing quantity, and saves on blur', async () => {
    vi.mocked(api.get).mockImplementation(async (path: string) => {
      if (path === '/orders/assortment') {
        return [{ brandId: 1, brandName: 'DarkSide', flavorId: 1, flavorName: 'CyberKiwi', weightId: 1, grams: 250, available: true }];
      }
      if (path === '/orders/mine') {
        return {
          round: { id: 5, vendorId: 1, status: 'open' },
          items: [{ brandId: 1, brandName: 'DarkSide', flavorId: 1, flavorName: 'CyberKiwi', weightId: 1, grams: 250, quantity: 2, totalEur: 10 }],
          totalKg: 0.5,
          totalEur: 10,
          hasUnavailableItems: false,
        };
      }
      return [];
    });
    vi.mocked(api.put).mockResolvedValue({});

    const user = userEvent.setup();
    render(<OrderBuilderPage />);
    const input = (await screen.findByLabelText(/CyberKiwi/)) as HTMLInputElement;
    expect(input.value).toBe('2');

    await user.clear(input);
    await user.type(input, '5');
    await user.tab();

    await waitFor(() =>
      expect(api.put).toHaveBeenCalledWith('/orders/items', { brandId: 1, flavorId: 1, weightId: 1, quantity: 5 })
    );
    expect(await screen.findByText(/0.50 кг, 10.00 €/)).toBeInTheDocument();
  });

  it('marks the specific order line that is no longer available', async () => {
    vi.mocked(api.get).mockImplementation(async (path: string) => {
      if (path === '/orders/assortment') {
        // The dropped flavor is gone from the assortment (server filters to available).
        return [{ brandId: 1, brandName: 'DarkSide', flavorId: 2, flavorName: 'Bananapapa', weightId: 1, grams: 250, available: true }];
      }
      if (path === '/orders/mine') {
        return {
          round: { id: 5, vendorId: 1, status: 'open' },
          items: [
            { brandId: 1, brandName: 'DarkSide', flavorId: 1, flavorName: 'CyberKiwi', weightId: 1, grams: 250, quantity: 2, totalEur: 10, available: false },
            { brandId: 1, brandName: 'DarkSide', flavorId: 2, flavorName: 'Bananapapa', weightId: 1, grams: 250, quantity: 1, totalEur: 5, available: true },
          ],
          totalKg: 0.75,
          totalEur: 15,
          hasUnavailableItems: true,
        };
      }
      return [];
    });

    render(<OrderBuilderPage />);

    const droppedLine = await screen.findByText(/CyberKiwi - 250г: x2/);
    expect(droppedLine).toHaveTextContent('больше не в наличии');
    const keptLine = screen.getByText(/Bananapapa - 250г: x1/);
    expect(keptLine).not.toHaveTextContent('больше не в наличии');
  });

  it('shows the error message when saving a quantity fails', async () => {
    vi.mocked(api.get).mockImplementation(async (path: string) => {
      if (path === '/orders/assortment') {
        return [{ brandId: 1, brandName: 'DarkSide', flavorId: 1, flavorName: 'CyberKiwi', weightId: 1, grams: 250, available: true }];
      }
      if (path === '/orders/mine') {
        return { round: { id: 5, vendorId: 1, status: 'open' }, items: [], totalKg: 0, totalEur: 0, hasUnavailableItems: false };
      }
      return [];
    });
    vi.mocked(api.put).mockRejectedValue(new Error('no price set for this brand yet'));

    const user = userEvent.setup();
    render(<OrderBuilderPage />);
    const input = (await screen.findByLabelText(/CyberKiwi/)) as HTMLInputElement;
    await user.type(input, '1');
    await user.tab();

    expect(await screen.findByRole('alert')).toHaveTextContent('no price set for this brand yet');
  });
});
