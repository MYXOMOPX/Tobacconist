import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AdminCatalogPage } from './AdminCatalogPage';
import { api } from '../apiClient';

vi.mock('../apiClient', () => ({
  api: { get: vi.fn(), post: vi.fn(), put: vi.fn() },
  uploadAvailabilityImage: vi.fn(),
}));

// The photo flow lives in AvailabilityReview and is covered by its own tests.

const vendors = [{ id: 1, name: 'Vasya', archived: false }];
const brands = [{ id: 1, name: 'DarkSide' }];
const weights = [{ id: 1, grams: 250 }];

beforeEach(() => {
  vi.mocked(api.get).mockImplementation(async (path: string) => {
    if (path === '/admin/vendors') return vendors;
    if (path === '/admin/brands') return brands;
    if (path === '/admin/weights') return weights;
    if (path.startsWith('/admin/vendors/1/prices')) return [];
    return [];
  });
  vi.mocked(api.post).mockResolvedValue({});
});

/** The vendor and brand forms both end in "Добавить" — scope to the right one. */
function addButtonFor(fieldLabel: string) {
  const row = screen.getByLabelText(fieldLabel).closest('.tb-fieldrow') as HTMLElement;
  return within(row).getByRole('button', { name: 'Добавить' });
}

describe('AdminCatalogPage', () => {
  it('creates a new vendor from the input field', async () => {
    const user = userEvent.setup();
    render(<AdminCatalogPage onOpenVendor={vi.fn()} />);
    await screen.findByText('Vasya');

    await user.type(screen.getByLabelText('Новый барыга'), 'Kolya');
    await user.click(addButtonFor('Новый барыга'));

    expect(api.post).toHaveBeenCalledWith('/admin/vendors', { name: 'Kolya' });
  });

  it('shows the error message when creating a vendor fails', async () => {
    const user = userEvent.setup();
    vi.mocked(api.post).mockRejectedValue(new Error('vendor name already used'));
    render(<AdminCatalogPage onOpenVendor={vi.fn()} />);
    await screen.findByText('Vasya');

    await user.type(screen.getByLabelText('Новый барыга'), 'Kolya');
    await user.click(addButtonFor('Новый барыга'));

    expect(await screen.findByRole('alert')).toHaveTextContent('vendor name already used');
  });

  it('loads a flavour list for a brand, one per line', async () => {
    const user = userEvent.setup();
    vi.mocked(api.post).mockResolvedValue({ added: ['Cola', 'Apple'], skipped: [] });
    render(<AdminCatalogPage onOpenVendor={vi.fn()} />);
    await user.click(await screen.findByRole('button', { name: /DarkSide/ }));

    await user.type(await screen.findByLabelText('Список вкусов DarkSide'), 'Cola{Enter}Apple');
    await user.click(screen.getByRole('button', { name: 'Загрузить список' }));

    expect(api.post).toHaveBeenCalledWith('/admin/brands/1/flavors/import', { text: ['Cola', 'Apple'].join('\n') });
    expect(await screen.findByText('Добавлено: 2')).toBeInTheDocument();
  });
});
