import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AdminCatalogPage } from './AdminCatalogPage';
import { api, uploadAvailabilityImage } from '../apiClient';

vi.mock('../apiClient', () => ({
  api: { get: vi.fn(), post: vi.fn(), put: vi.fn() },
  uploadAvailabilityImage: vi.fn(),
}));

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

describe('AdminCatalogPage', () => {
  it('creates a new vendor from the input field', async () => {
    const user = userEvent.setup();
    render(<AdminCatalogPage />);
    await screen.findByText('Vasya');

    await user.type(screen.getByPlaceholderText('Новый барыга'), 'Kolya');
    await user.click(screen.getByText('Добавить барыгу'));

    expect(api.post).toHaveBeenCalledWith('/admin/vendors', { name: 'Kolya' });
  });

  it('uploads an image, shows the proposed entries, and confirms them', async () => {
    const user = userEvent.setup();
    vi.mocked(uploadAvailabilityImage).mockResolvedValue({
      entries: [{ name: 'CyberKiwi', available: true }],
    });
    render(<AdminCatalogPage />);

    await user.click(await screen.findByText('Vasya'));
    await user.selectOptions(screen.getByDisplayValue('Бренд...'), '1');
    await user.selectOptions(screen.getByDisplayValue('Граммовка...'), '1');

    const file = new File(['bytes'], 'photo.jpg', { type: 'image/jpeg' });
    const fileInput = screen.getByLabelText('Файл наличия', { selector: 'input' }) as HTMLInputElement;
    await user.upload(fileInput, file);

    expect(await screen.findByText('CyberKiwi')).toBeInTheDocument();

    await user.click(screen.getByText('Сохранить наличие'));
    await waitFor(() =>
      expect(api.post).toHaveBeenCalledWith('/admin/availability/confirm', {
        vendorId: 1,
        brandId: 1,
        weightId: 1,
        entries: [{ name: 'CyberKiwi', available: true }],
      })
    );
  });

  it('shows the error message when the Gemini parse fails', async () => {
    const user = userEvent.setup();
    vi.mocked(uploadAvailabilityImage).mockRejectedValue(new Error('failed to parse availability image'));
    render(<AdminCatalogPage />);

    await user.click(await screen.findByText('Vasya'));
    await user.selectOptions(screen.getByDisplayValue('Бренд...'), '1');
    await user.selectOptions(screen.getByDisplayValue('Граммовка...'), '1');

    const file = new File(['bytes'], 'photo.jpg', { type: 'image/jpeg' });
    const fileInput = screen.getByLabelText('Файл наличия', { selector: 'input' }) as HTMLInputElement;
    await user.upload(fileInput, file);

    expect(await screen.findByRole('alert')).toHaveTextContent('failed to parse availability image');
    // Spinner released, and nothing bogus proposed.
    expect(fileInput.disabled).toBe(false);
    expect(screen.queryByText('Проверь распознанное')).not.toBeInTheDocument();
  });

  it('shows the error message when creating a vendor fails', async () => {
    const user = userEvent.setup();
    vi.mocked(api.post).mockRejectedValue(new Error('vendor name already used'));
    render(<AdminCatalogPage />);
    await screen.findByText('Vasya');

    await user.type(screen.getByPlaceholderText('Новый барыга'), 'Kolya');
    await user.click(screen.getByText('Добавить барыгу'));

    expect(await screen.findByRole('alert')).toHaveTextContent('vendor name already used');
  });
});
