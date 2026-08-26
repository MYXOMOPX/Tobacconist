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
});
