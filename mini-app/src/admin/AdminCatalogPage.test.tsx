import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AdminCatalogPage } from './AdminCatalogPage';
import { api } from '../apiClient';

vi.mock('../apiClient', () => ({
  api: { get: vi.fn(), post: vi.fn(), put: vi.fn(), delete: vi.fn() },
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

  it('previews duplicates and merges only what stays ticked', async () => {
    const user = userEvent.setup();
    vi.mocked(api.post).mockImplementation(async (path: string) => {
      if (path.endsWith('/duplicates')) {
        return {
          judgedByAi: true,
          groups: [
            { keep: { id: 1, name: 'FRUITALITY' }, duplicates: [{ id: 2, name: 'FRUITTALLLITY' }] },
            { keep: { id: 3, name: 'MINT' }, duplicates: [{ id: 4, name: 'MIST' }] },
          ],
        };
      }
      return { merged: 1 };
    });
    render(<AdminCatalogPage onOpenVendor={vi.fn()} />);
    await user.click(await screen.findByRole('button', { name: /DarkSide/ }));
    await user.click(await screen.findByRole('button', { name: 'Найти дубли и опечатки' }));

    await user.click(await screen.findByRole('button', { name: /MIST → MINT/ }));
    await user.click(screen.getByRole('button', { name: 'Слить выбранное' }));

    expect(api.post).toHaveBeenCalledWith('/admin/brands/1/flavors/merge', {
      merges: [{ keepId: 1, dropIds: [2] }],
    });
  });

  it('warns that orders go with a brand that has them, and deletes only after confirmation', async () => {
    const user = userEvent.setup();
    vi.mocked(api.get).mockImplementation(async (path: string) => {
      if (path === '/admin/brands/1/usage') return { orders: 3, activeOrders: 1 };
      if (path === '/admin/vendors') return vendors;
      if (path === '/admin/brands') return brands;
      return [];
    });
    vi.mocked(api.delete).mockResolvedValue({ deletedOrders: 3 });
    render(<AdminCatalogPage onOpenVendor={vi.fn()} />);
    await user.click(await screen.findByRole('button', { name: /DarkSide/ }));
    await user.click(await screen.findByRole('button', { name: 'Удалить бренд' }));

    expect(await screen.findByText(/Есть заказы с брендом DarkSide: 3/)).toBeInTheDocument();
    expect(api.delete).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'Удалить' }));

    expect(api.delete).toHaveBeenCalledWith('/admin/brands/1?withOrders=true');
  });

  it('deletes an unused brand without the orders flag', async () => {
    const user = userEvent.setup();
    vi.mocked(api.get).mockImplementation(async (path: string) => {
      if (path === '/admin/brands/1/usage') return { orders: 0, activeOrders: 0 };
      if (path === '/admin/vendors') return vendors;
      if (path === '/admin/brands') return brands;
      return [];
    });
    vi.mocked(api.delete).mockResolvedValue({ deletedOrders: 0 });
    render(<AdminCatalogPage onOpenVendor={vi.fn()} />);
    await user.click(await screen.findByRole('button', { name: /DarkSide/ }));
    await user.click(await screen.findByRole('button', { name: 'Удалить бренд' }));
    await user.click(await screen.findByRole('button', { name: 'Удалить' }));

    expect(api.delete).toHaveBeenCalledWith('/admin/brands/1');
  });
});
