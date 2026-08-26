import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AdminRoundPage } from './AdminRoundPage';
import { api } from '../apiClient';

vi.mock('../apiClient', () => ({ api: { get: vi.fn(), post: vi.fn(), put: vi.fn() } }));

describe('AdminRoundPage — no active round', () => {
  it('lists vendors and starts a round on click', async () => {
    vi.mocked(api.get).mockImplementation(async (path: string) => {
      if (path === '/rounds/active') return null;
      if (path === '/admin/vendors') return [{ id: 1, name: 'Vasya', archived: false }];
      return [];
    });
    vi.mocked(api.post).mockResolvedValue({ id: 5, vendorId: 1, vendorName: 'Vasya', status: 'open', openedAt: '', closedAt: null });

    const user = userEvent.setup();
    render(<AdminRoundPage />);
    await user.click(await screen.findByText('Vasya'));

    expect(api.post).toHaveBeenCalledWith('/rounds', { vendorId: 1 });
  });

  it('excludes archived vendors from the start-round list', async () => {
    vi.mocked(api.get).mockImplementation(async (path: string) => {
      if (path === '/rounds/active') return null;
      if (path === '/admin/vendors')
        return [
          { id: 1, name: 'Vasya', archived: false },
          { id: 2, name: 'OldSupplier', archived: true },
        ];
      return [];
    });

    render(<AdminRoundPage />);
    await screen.findByText('Vasya');

    expect(screen.queryByText('OldSupplier')).not.toBeInTheDocument();
  });
});

describe('AdminRoundPage — open round', () => {
  const round = { id: 5, vendorId: 1, vendorName: 'Vasya', status: 'open', openedAt: '', closedAt: null };

  beforeEach(() => {
    vi.mocked(api.get).mockImplementation(async (path: string) => {
      if (path === '/rounds/active') return round;
      if (path === '/rounds/5/snapshot') {
        return { text: 'DarkSide - CyberKiwi - 250g - x3', table: [{ brand: 'DarkSide', flavor: 'CyberKiwi', weight: '250g', quantity: 3, totalEur: 15 }] };
      }
      if (path === '/rounds/5/payments') return [{ userId: 2, displayName: 'Friend', paid: false }];
      return [];
    });
    vi.mocked(api.post).mockResolvedValue({});
  });

  it('shows the snapshot text and closes the round', async () => {
    const user = userEvent.setup();
    render(<AdminRoundPage />);
    await screen.findByText(/CyberKiwi - 250g - x3/);

    await user.click(screen.getByText('Закрыть раунд'));
    expect(api.post).toHaveBeenCalledWith('/rounds/5/close');
  });

  it('renders the snapshot table alongside the text view', async () => {
    render(<AdminRoundPage />);
    const row = await screen.findByRole('row', { name: /DarkSide/ });

    expect(row).toHaveTextContent('DarkSide');
    expect(row).toHaveTextContent('CyberKiwi');
    expect(row).toHaveTextContent('250g');
    expect(row).toHaveTextContent('3');
    expect(row).toHaveTextContent('15');
  });

  it('toggles a participant paid status', async () => {
    const user = userEvent.setup();
    render(<AdminRoundPage />);
    const checkbox = await screen.findByLabelText('Friend');
    await user.click(checkbox);
    await waitFor(() => expect(api.post).toHaveBeenCalledWith('/rounds/5/payments/2', { paid: true }));
  });
});
