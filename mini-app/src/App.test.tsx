import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { App } from './App';

vi.mock('./apiClient', () => ({
  api: {
    get: vi.fn(async (path: string) => {
      if (path === '/me') return { id: 1, telegramId: '1', displayName: 'Admin', role: 'admin' };
      if (path === '/rounds/active') return null;
      if (path === '/history')
        return [{ id: 7, vendorId: 1, vendorName: 'Vasya', status: 'closed', openedAt: '', closedAt: '2026-08-01' }];
      if (path === '/rounds/7')
        return { id: 7, vendorId: 1, vendorName: 'Vasya', status: 'closed', openedAt: '', closedAt: '2026-08-01' };
      if (path === '/rounds/7/snapshot') return { text: '', table: [] };
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
    expect(screen.getByText('Раунд')).toBeInTheDocument();
  });

  it('switches to the catalog tab', async () => {
    const user = userEvent.setup();
    render(<App />);
    await screen.findByTestId('shell');

    await user.click(screen.getByText('Каталог'));
    expect(await screen.findByText('Барыги')).toBeInTheDocument();
  });

  it('gives the admin a history tab that lists closed rounds', async () => {
    const user = userEvent.setup();
    render(<App />);
    await screen.findByTestId('shell');

    await user.click(screen.getByText('История'));
    expect(await screen.findByText('История закупок')).toBeInTheDocument();
    expect(await screen.findByRole('button', { name: /Vasya/ })).toBeInTheDocument();
  });
});
