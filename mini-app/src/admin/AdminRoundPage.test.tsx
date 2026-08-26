import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AdminRoundPage } from './AdminRoundPage';
import { api } from '../apiClient';

vi.mock('../apiClient', () => ({ api: { get: vi.fn(), post: vi.fn(), put: vi.fn() } }));

const openRound = { id: 5, vendorId: 1, vendorName: 'Vasya', status: 'open', openedAt: '', closedAt: null };
const closedRound = { id: 5, vendorId: 1, vendorName: 'Vasya', status: 'closed', openedAt: '', closedAt: '2026-08-20T10:00:00.000Z' };
const snapshot = {
  text: 'DarkSide - CyberKiwi - 250g - x3',
  table: [{ brand: 'DarkSide', flavor: 'CyberKiwi', weight: '250g', quantity: 3, totalEur: 15 }],
};
const summaries = [{ userId: 2, displayName: 'Friend', totalKg: 0.75, totalEur: 15, paid: false }];
const checklist = [
  { id: 11, brandName: 'DarkSide', flavorName: 'CyberKiwi', grams: 250, expectedQty: 3, receivedQty: 0 },
];

describe('AdminRoundPage — no active round and no history', () => {
  beforeEach(() => {
    vi.mocked(api.get).mockImplementation(async (path: string) => {
      if (path === '/rounds/active') return null;
      if (path === '/history') return [];
      if (path === '/admin/vendors') return [{ id: 1, name: 'Vasya', archived: false }];
      return [];
    });
  });

  it('lists vendors and starts a round on click', async () => {
    vi.mocked(api.post).mockResolvedValue(openRound);
    vi.mocked(api.get).mockImplementation(async (path: string) => {
      if (path === '/rounds/active') return null;
      if (path === '/history') return [];
      if (path === '/admin/vendors') return [{ id: 1, name: 'Vasya', archived: false }];
      if (path === '/rounds/5') return openRound;
      if (path === '/rounds/5/snapshot') return snapshot;
      if (path === '/rounds/5/summaries') return summaries;
      return [];
    });

    const user = userEvent.setup();
    render(<AdminRoundPage />);
    await user.click(await screen.findByText('Vasya'));

    expect(api.post).toHaveBeenCalledWith('/rounds', { vendorId: 1 });
    // Loads the newly created round by id (works regardless of its status).
    await waitFor(() => expect(api.get).toHaveBeenCalledWith('/rounds/5'));
  });

  it('excludes archived vendors from the start-round list', async () => {
    vi.mocked(api.get).mockImplementation(async (path: string) => {
      if (path === '/rounds/active') return null;
      if (path === '/history') return [];
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

  it('shows the error message when the initial load fails', async () => {
    vi.mocked(api.get).mockRejectedValue(new Error('not a member of the group'));

    render(<AdminRoundPage />);

    expect(await screen.findByRole('alert')).toHaveTextContent('not a member of the group');
  });
});

describe('AdminRoundPage — open round', () => {
  beforeEach(() => {
    vi.mocked(api.get).mockImplementation(async (path: string) => {
      if (path === '/rounds/active') return openRound;
      if (path === '/rounds/5') return openRound;
      if (path === '/rounds/5/snapshot') return snapshot;
      if (path === '/rounds/5/summaries') return summaries;
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

  it('shows each participant total kg and euro next to their name', async () => {
    render(<AdminRoundPage />);
    const item = await screen.findByText(/0\.75 кг/);
    expect(item).toHaveTextContent('15.00 €');
  });

  it('shows an error message when an action fails', async () => {
    vi.mocked(api.post).mockRejectedValue(new Error('round is already closed'));
    const user = userEvent.setup();
    render(<AdminRoundPage />);
    await user.click(await screen.findByText('Закрыть раунд'));

    expect(await screen.findByRole('alert')).toHaveTextContent('round is already closed');
  });

  it('keeps showing the round (with its checklist) after closing it', async () => {
    // /rounds/active goes null once the round is closed — the page must reload by id.
    let closed = false;
    vi.mocked(api.get).mockImplementation(async (path: string) => {
      if (path === '/rounds/active') return closed ? null : openRound;
      if (path === '/rounds/5') return closed ? closedRound : openRound;
      if (path === '/rounds/5/snapshot') return snapshot;
      if (path === '/rounds/5/summaries') return summaries;
      if (path === '/rounds/5/checklist') return checklist;
      if (path === '/history') return closed ? [closedRound] : [];
      return [];
    });
    vi.mocked(api.post).mockImplementation(async () => {
      closed = true;
      return {};
    });

    const user = userEvent.setup();
    render(<AdminRoundPage />);
    await user.click(await screen.findByText('Закрыть раунд'));

    expect(await screen.findByText('Сверка поставки')).toBeInTheDocument();
    expect(screen.getByText(/нужно 3, привезли/)).toBeInTheDocument();
    expect(screen.getByText('Переоткрыть раунд')).toBeInTheDocument();
    expect(screen.queryByText('Начать раунд')).not.toBeInTheDocument();
  });
});

describe('AdminRoundPage — no open round but history exists', () => {
  it('loads the most recent closed round on mount, with checklist and reopen UI', async () => {
    const older = { id: 4, vendorId: 1, vendorName: 'Petya', status: 'closed', openedAt: '', closedAt: '2026-08-01T10:00:00.000Z' };
    vi.mocked(api.get).mockImplementation(async (path: string) => {
      if (path === '/rounds/active') return null;
      if (path === '/history') return [older, closedRound];
      if (path === '/rounds/5') return closedRound;
      if (path === '/rounds/5/snapshot') return snapshot;
      if (path === '/rounds/5/summaries') return summaries;
      if (path === '/rounds/5/checklist') return checklist;
      if (path === '/admin/vendors') return [{ id: 1, name: 'Vasya', archived: false }];
      return [];
    });

    render(<AdminRoundPage />);

    expect(await screen.findByText(/Раунд #5/)).toHaveTextContent('closed');
    expect(screen.getByText('Сверка поставки')).toBeInTheDocument();
    expect(screen.getByText(/нужно 3, привезли/)).toBeInTheDocument();
    expect(screen.getByText('Переоткрыть раунд')).toBeInTheDocument();
    // The older closed round must not be the one selected.
    expect(api.get).not.toHaveBeenCalledWith('/rounds/4');
  });
});
