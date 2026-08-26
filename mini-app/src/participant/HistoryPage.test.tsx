import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { HistoryPage } from './HistoryPage';
import { api } from '../apiClient';

vi.mock('../apiClient', () => ({ api: { get: vi.fn(), post: vi.fn(), put: vi.fn() } }));

describe('HistoryPage', () => {
  it('lists closed rounds and shows the selected round detail on click', async () => {
    vi.mocked(api.get).mockImplementation(async (path: string) => {
      if (path === '/history') {
        return [{ id: 7, vendorId: 1, vendorName: 'Vasya', status: 'closed', openedAt: '', closedAt: '2026-08-01' }];
      }
      if (path === '/history/7') {
        return {
          round: { id: 7, vendorId: 1, vendorName: 'Vasya', status: 'closed', openedAt: '', closedAt: '2026-08-01' },
          items: [],
          totalKg: 0.75,
          totalEur: 15,
          paid: true,
        };
      }
      return [];
    });

    const user = userEvent.setup();
    render(<HistoryPage />);
    await user.click(await screen.findByText(/Vasya/));

    expect(await screen.findByText(/0.75 кг, 15.00 €/)).toBeInTheDocument();
    expect(screen.getByText(/— оплачено$/)).toBeInTheDocument();
    expect(screen.queryByText(/не оплачено/)).not.toBeInTheDocument();
  });

  it('works unchanged for an admin caller, whose /history lists every closed round', async () => {
    // The server returns ALL closed rounds for admins; the detail view carries the
    // caller's own (possibly zero) totals.
    vi.mocked(api.get).mockImplementation(async (path: string) => {
      if (path === '/history') {
        return [
          { id: 7, vendorId: 1, vendorName: 'Vasya', status: 'closed', openedAt: '', closedAt: '2026-08-01' },
          { id: 8, vendorId: 2, vendorName: 'Petya', status: 'closed', openedAt: '', closedAt: '2026-08-10' },
        ];
      }
      if (path === '/history/8') {
        return {
          round: { id: 8, vendorId: 2, vendorName: 'Petya', status: 'closed', openedAt: '', closedAt: '2026-08-10' },
          items: [],
          totalKg: 0,
          totalEur: 0,
          paid: false,
        };
      }
      return [];
    });

    const user = userEvent.setup();
    render(<HistoryPage />);
    expect(await screen.findByText(/Vasya/)).toBeInTheDocument();
    await user.click(await screen.findByText(/Petya/));

    expect(await screen.findByText(/0.00 кг, 0.00 €/)).toBeInTheDocument();
    expect(screen.getByText(/не оплачено$/)).toBeInTheDocument();
  });

  it('shows the error message when the history load fails', async () => {
    vi.mocked(api.get).mockRejectedValue(new Error('round not found'));
    render(<HistoryPage />);
    expect(await screen.findByRole('alert')).toHaveTextContent('round not found');
  });
});
