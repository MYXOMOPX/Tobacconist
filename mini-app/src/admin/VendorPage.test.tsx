import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { VendorPage } from './VendorPage';
import { api } from '../apiClient';

vi.mock('../apiClient', () => ({
  api: { get: vi.fn(), post: vi.fn(), put: vi.fn(), patch: vi.fn(), delete: vi.fn() },
  uploadAvailabilityImage: vi.fn(),
}));

const vendors = [{ id: 7, name: 'Darian Shisha', archived: false }];
const brands = [{ id: 1, name: 'DarkSide' }];
const weights = [
  { id: 1, grams: 100 },
  { id: 2, grams: 250 },
];
const stock = [
  {
    brandId: 1,
    brandName: 'DarkSide',
    flavorId: 10,
    flavorName: 'Needls',
    weightId: 2,
    grams: 250,
    available: true,
  },
  {
    brandId: 1,
    brandName: 'DarkSide',
    flavorId: 11,
    flavorName: 'Desert Eagle',
    weightId: 2,
    grams: 250,
    available: false,
  },
];

function mockApi(overrides: Record<string, unknown> = {}) {
  vi.mocked(api.get).mockImplementation(async (path: string) => {
    if (path.startsWith('/admin/vendors?')) return overrides.vendors ?? vendors;
    if (path === '/admin/brands') return brands;
    if (path === '/admin/weights') return weights;
    if (path === '/admin/vendors/7/prices') return overrides.prices ?? [];
    if (path === '/admin/vendors/7/availability') return overrides.stock ?? stock;
    return [];
  });
}

beforeEach(() => {
  // Call history leaks between cases otherwise, and "was never called" lies.
  vi.clearAllMocks();
  vi.mocked(api.put).mockResolvedValue({});
  vi.mocked(api.patch).mockResolvedValue({});
  vi.mocked(api.delete).mockResolvedValue({});
});

describe('VendorPage', () => {
  it('shows the stock grouped by brand and weight, with a count', async () => {
    mockApi();
    render(<VendorPage vendorId={7} onBack={vi.fn()} />);

    expect(await screen.findByText('DarkSide · 250г')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Needls/ })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: /Desert Eagle/ })).toHaveAttribute(
      'aria-pressed',
      'false'
    );
    // One of two flavours is in stock.
    expect(screen.getByText('1 / 2')).toBeInTheDocument();
  });

  it('flips one position by hand', async () => {
    mockApi();
    const user = userEvent.setup();
    render(<VendorPage vendorId={7} onBack={vi.fn()} />);

    await user.click(await screen.findByRole('button', { name: /Needls/ }));

    await waitFor(() =>
      expect(api.put).toHaveBeenCalledWith('/admin/vendors/7/availability', {
        brandId: 1,
        weightId: 2,
        flavorId: 10,
        available: false,
      })
    );
  });

  it('adds a flavour the model never saw', async () => {
    mockApi();
    const user = userEvent.setup();
    render(<VendorPage vendorId={7} onBack={vi.fn()} />);

    const form = (await screen.findByText('Добавить позицию руками')).closest('.tb-card') as HTMLElement;
    await user.selectOptions(within(form).getByLabelText('Бренд'), '1');
    await user.selectOptions(within(form).getByLabelText('Граммовка'), '2');
    await user.type(screen.getByLabelText('Название вкуса'), 'Cosmo Pole');
    await user.click(
      within(screen.getByLabelText('Название вкуса').closest('.tb-fieldrow') as HTMLElement).getByRole('button', {
        name: 'Добавить',
      })
    );

    await waitFor(() =>
      expect(api.put).toHaveBeenCalledWith('/admin/vendors/7/availability', {
        brandId: 1,
        weightId: 2,
        flavorName: 'Cosmo Pole',
        available: true,
      })
    );
  });

  it('says the stock is empty rather than showing a blank card', async () => {
    mockApi({ stock: [] });
    render(<VendorPage vendorId={7} onBack={vi.fn()} />);
    expect(await screen.findByText('Наличие пустое')).toBeInTheDocument();
  });

  it('renames the vendor', async () => {
    mockApi();
    const user = userEvent.setup();
    render(<VendorPage vendorId={7} onBack={vi.fn()} />);

    const field = await screen.findByLabelText('Как зовут барыгу');
    await user.clear(field);
    await user.type(field, 'Boss Shisha');
    await user.click(
      within(field.closest('.tb-fieldrow') as HTMLElement).getByRole('button', { name: 'Сохранить' })
    );

    expect(api.patch).toHaveBeenCalledWith('/admin/vendors/7', { name: 'Boss Shisha' });
  });

  it('saves a price per kilogram', async () => {
    mockApi();
    const user = userEvent.setup();
    render(<VendorPage vendorId={7} onBack={vi.fn()} />);

    await user.type(await screen.findByLabelText('DarkSide, €/кг'), '42');
    await user.click(
      within(screen.getByLabelText('DarkSide, €/кг').closest('.tb-fieldrow') as HTMLElement).getByRole('button', {
        name: 'Сохранить',
      })
    );

    expect(api.put).toHaveBeenCalledWith('/admin/vendors/7/prices/1', { pricePerKgEur: 42 });
  });

  it('asks before deleting, and says what will actually happen', async () => {
    mockApi();
    const onBack = vi.fn();
    const user = userEvent.setup();
    render(<VendorPage vendorId={7} onBack={onBack} />);

    await user.click(await screen.findByRole('button', { name: 'Удалить барыгу' }));

    const dialog = within(await screen.findByRole('dialog'));
    expect(screen.getByText('Удалить Darian Shisha?')).toBeInTheDocument();
    expect(dialog.getByText(/он уйдёт в архив/)).toBeInTheDocument();
    expect(api.delete).not.toHaveBeenCalled();

    await user.click(dialog.getByRole('button', { name: 'Удалить' }));

    await waitFor(() => expect(api.delete).toHaveBeenCalledWith('/admin/vendors/7'));
    expect(onBack).toHaveBeenCalled();
  });

  it('deletes nothing when the confirmation is dismissed', async () => {
    mockApi();
    const user = userEvent.setup();
    render(<VendorPage vendorId={7} onBack={vi.fn()} />);

    await user.click(await screen.findByRole('button', { name: 'Удалить барыгу' }));
    await user.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Отмена' }));

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(api.delete).not.toHaveBeenCalled();
  });
});
