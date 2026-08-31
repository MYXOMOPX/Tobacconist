import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { HistoryPage } from './HistoryPage';
import { api } from '../apiClient';

vi.mock('../apiClient', () => ({ api: { get: vi.fn(), post: vi.fn(), put: vi.fn() } }));

describe('HistoryPage', () => {
  it('lists finished orders and shows the selected one on click', async () => {
    vi.mocked(api.get).mockImplementation(async (path: string) => {
      if (path === '/history') {
        return [{ id: 7, vendorId: 1, vendorName: 'Vasya', status: 'done', createdAt: '', statusChangedAt: '2026-08-01T00:00:00.000Z' }];
      }
      if (path === '/history/7') {
        return {
          order: { id: 7, vendorId: 1, vendorName: 'Vasya', status: 'done', createdAt: '', statusChangedAt: '2026-08-01T00:00:00.000Z' },
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
    await user.click(await screen.findByRole('button', { name: /Vasya/ }));

    const detail = (await screen.findByText('Итого')).closest('.tb-card');
    expect(detail).toHaveTextContent('0.75');
    expect(detail).toHaveTextContent('15.00');
    expect(detail).toHaveTextContent('Оплачено');
    expect(screen.queryByText('Не оплачено')).not.toBeInTheDocument();
  });

  it('works unchanged for an admin caller, whose /history lists every finished order', async () => {
    // The server returns ALL closed rounds for admins; the detail view carries the
    // caller's own (possibly zero) totals.
    vi.mocked(api.get).mockImplementation(async (path: string) => {
      if (path === '/history') {
        return [
          { id: 7, vendorId: 1, vendorName: 'Vasya', status: 'done', createdAt: '', statusChangedAt: '2026-08-01T00:00:00.000Z' },
          { id: 8, vendorId: 2, vendorName: 'Petya', status: 'rejected', createdAt: '', statusChangedAt: '2026-08-10T00:00:00.000Z' },
        ];
      }
      if (path === '/history/8') {
        return {
          order: { id: 8, vendorId: 2, vendorName: 'Petya', status: 'rejected', createdAt: '', statusChangedAt: '2026-08-10T00:00:00.000Z' },
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
    expect(await screen.findByRole('button', { name: /Vasya/ })).toBeInTheDocument();
    await user.click(await screen.findByRole('button', { name: /Petya/ }));

    const detail = (await screen.findByText('Итого')).closest('.tb-card');
    expect(detail).toHaveTextContent('0.00');
    expect(detail).toHaveTextContent('Не оплачено');
  });

  it('invites the user to act when there is nothing in the history yet', async () => {
    vi.mocked(api.get).mockResolvedValue([]);
    render(<HistoryPage />);
    expect(await screen.findByText('Здесь пока пусто')).toBeInTheDocument();
  });

  it('shows the error message when the history load fails', async () => {
    vi.mocked(api.get).mockRejectedValue(new Error('round not found'));
    render(<HistoryPage />);
    expect(await screen.findByRole('alert')).toHaveTextContent('round not found');
  });
});
