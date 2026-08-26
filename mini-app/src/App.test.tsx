import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { App } from './App';

vi.mock('./apiClient', () => ({
  api: { get: vi.fn().mockResolvedValue({ id: 1, telegramId: '1', displayName: 'Admin', role: 'admin' }) },
}));

describe('App', () => {
  it('renders the admin shell once /api/me resolves', async () => {
    render(<App />);
    expect(await screen.findByTestId('shell')).toHaveTextContent('Админ-панель');
  });
});
