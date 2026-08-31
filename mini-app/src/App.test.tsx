import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { App } from './App';

vi.mock('./apiClient', () => ({
  api: {
    get: vi.fn(async (path: string) => {
      if (path === '/me') return { id: 1, telegramId: '1', displayName: 'Admin', role: 'admin' };
      if (path === '/orders') return [];
      if (path === '/history')
        return [
          {
            id: 7,
            vendorId: 1,
            vendorName: 'Vasya',
            status: 'done',
            createdAt: '2026-08-01T00:00:00.000Z',
            statusChangedAt: '2026-08-01T00:00:00.000Z',
          },
        ];
      return [];
    }),
    post: vi.fn(),
    put: vi.fn(),
  },
  uploadAvailabilityImage: vi.fn(),
}));

describe('App', () => {
  it('renders the admin shell once /api/me resolves', async () => {
    render(<App />);
    await screen.findByTestId('shell');
    expect(screen.getByRole('button', { name: 'Заказы' })).toHaveAttribute('aria-current', 'page');
  });

  it('switches to the vendors tab', async () => {
    const user = userEvent.setup();
    render(<App />);
    await screen.findByTestId('shell');

    await user.click(screen.getByRole('button', { name: 'Барыги' }));
    expect(await screen.findByText('Барыги и цены')).toBeInTheDocument();
  });

  it('gives the admin a history tab that lists past orders', async () => {
    const user = userEvent.setup();
    render(<App />);
    await screen.findByTestId('shell');

    await user.click(screen.getByRole('button', { name: 'История' }));
    expect(await screen.findByText('История закупок')).toBeInTheDocument();
    expect(await screen.findByRole('button', { name: /Vasya/ })).toBeInTheDocument();
  });
});
