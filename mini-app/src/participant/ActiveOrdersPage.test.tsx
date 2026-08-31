import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ActiveOrdersPage } from './ActiveOrdersPage';
import { api } from '../apiClient';

vi.mock('../apiClient', () => ({ api: { get: vi.fn(), post: vi.fn(), put: vi.fn() } }));

const vasya = { id: 5, vendorId: 1, vendorName: 'Vasya', status: 'ordering', createdAt: '', statusChangedAt: '' };
const petya = { id: 6, vendorId: 2, vendorName: 'Petya', status: 'awaiting_validation', createdAt: '', statusChangedAt: '' };

describe('ActiveOrdersPage', () => {
  it('invites the participant to wait when nothing is collecting', async () => {
    vi.mocked(api.get).mockResolvedValue([]);
    render(<ActiveOrdersPage onOpen={vi.fn()} />);
    expect(await screen.findByText('Активных заказов нет')).toBeInTheDocument();
  });

  it('lists every open order with its status and the caller own totals', async () => {
    vi.mocked(api.get).mockImplementation(async (path: string) => {
      if (path === '/orders') return [vasya, petya];
      if (path === '/orders/5/mine') {
        return {
          order: vasya,
          items: [{ quantity: 2 }],
          totalKg: 0.5,
          totalEur: 10.5,
          ready: false,
          paid: false,
          hasUnavailableItems: false,
        };
      }
      return { order: petya, items: [], totalKg: 0, totalEur: 0, ready: false, paid: false, hasUnavailableItems: false };
    });

    render(<ActiveOrdersPage onOpen={vi.fn()} />);

    const first = (await screen.findByText('Vasya')).closest('button');
    expect(first).toHaveTextContent('10.50');
    expect(first).toHaveTextContent('Сбор заказов');

    const second = screen.getByText('Petya').closest('button');
    expect(second).toHaveTextContent('ты ещё не заказывал');
    expect(second).toHaveTextContent('На сверке');
  });

  it('opens the order that was tapped', async () => {
    vi.mocked(api.get).mockImplementation(async (path: string) => {
      if (path === '/orders') return [vasya];
      return { order: vasya, items: [], totalKg: 0, totalEur: 0, ready: false, paid: false, hasUnavailableItems: false };
    });
    const onOpen = vi.fn();
    const user = userEvent.setup();
    render(<ActiveOrdersPage onOpen={onOpen} />);

    await user.click(await screen.findByText('Vasya'));
    expect(onOpen).toHaveBeenCalledWith(5);
  });
});
