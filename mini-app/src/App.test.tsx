import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { App } from './App';

vi.mock('./apiClient', () => ({
  api: {
    get: vi.fn(async (path: string) => {
      if (path === '/me') return { id: 1, telegramId: '1', displayName: 'Admin', role: 'admin' };
      return [];
    }),
  },
  uploadAvailabilityImage: vi.fn(),
}));

describe('App', () => {
  it('renders the admin shell once /api/me resolves', async () => {
    render(<App />);
    expect(await screen.findByTestId('shell')).toHaveTextContent('Барыги');
  });
});
