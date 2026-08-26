import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { App } from './App';

vi.mock('./apiClient', () => ({
  api: {
    get: vi.fn(async (path: string) => {
      if (path === '/me') return { id: 1, telegramId: '1', displayName: 'Admin', role: 'admin' };
      if (path === '/rounds/active') return null;
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
    expect(await screen.findByTestId('shell')).toBeInTheDocument();
  });

  it('switches to the catalog tab', async () => {
    const user = userEvent.setup();
    render(<App />);
    await screen.findByTestId('shell');

    await user.click(screen.getByText('Каталог'));
    expect(await screen.findByText('Барыги')).toBeInTheDocument();
  });
});
