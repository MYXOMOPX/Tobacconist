import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AvailabilityReview } from './AvailabilityReview';
import { api, uploadAvailabilityImage } from '../apiClient';

vi.mock('../apiClient', () => ({
  api: { get: vi.fn(), post: vi.fn(), put: vi.fn() },
  uploadAvailabilityImage: vi.fn(),
}));

const brands = [
  { id: 1, name: 'DarkSide' },
  { id: 2, name: 'MustHave' },
];
const weights = [
  { id: 1, grams: 100 },
  { id: 2, grams: 250 },
];

function setup() {
  const onSaved = vi.fn();
  render(
    <AvailabilityReview
      vendorId={7}
      vendorName="Darian Shisha"
      brands={brands}
      weights={weights}
      onSaved={onSaved}
    />
  );
  return { onSaved, user: userEvent.setup() };
}

function shot(name: string) {
  return new File(['bytes'], name, { type: 'image/jpeg' });
}

beforeEach(() => {
  vi.mocked(api.post).mockResolvedValue({});
});

describe('AvailabilityReview', () => {
  it('fills brand and weight from what the screenshot said', async () => {
    vi.mocked(uploadAvailabilityImage).mockResolvedValue({
      detectedBrandName: 'DARKSIDE CORE',
      brandId: 1,
      detectedGrams: 250,
      weightId: 2,
      entries: [
        { name: 'Needls', available: true },
        { name: 'Desert Eagle', available: false },
      ],
    });

    const { user } = setup();
    await user.upload(screen.getByLabelText('Скрины наличия'), shot('darkside.jpg'));

    expect(await screen.findByText('DARKSIDE CORE')).toBeInTheDocument();
    expect(screen.getByLabelText('Бренд')).toHaveValue('1');
    expect(screen.getByLabelText('Граммовка')).toHaveValue('2');
    expect(screen.getByRole('button', { name: /Needls/ })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: /Desert Eagle/ })).toHaveAttribute(
      'aria-pressed',
      'false'
    );
  });

  it('flags a corrected spelling and shows the original on tap', async () => {
    vi.mocked(uploadAvailabilityImage).mockResolvedValue({
      detectedBrandName: 'DarkSide',
      brandId: 1,
      detectedGrams: 250,
      weightId: 2,
      entries: [{ name: 'Fruitality', available: true, originalName: 'Fruittalllity' }],
    });

    const { user } = setup();
    await user.upload(screen.getByLabelText('Скрины наличия'), shot('a.jpg'));
    await user.click(await screen.findByRole('button', { name: 'Исправлена опечатка' }));

    expect(screen.getByRole('tooltip')).toHaveTextContent('Распознано: Fruittalllity');
  });

  it('saves the whole batch and reports what was reviewed', async () => {
    vi.mocked(uploadAvailabilityImage).mockResolvedValue({
      detectedBrandName: 'DarkSide',
      brandId: 1,
      detectedGrams: 250,
      weightId: 2,
      entries: [{ name: 'Needls', available: true }],
    });

    const { user, onSaved } = setup();
    await user.upload(screen.getByLabelText('Скрины наличия'), shot('darkside.jpg'));
    await user.click(await screen.findByRole('button', { name: 'Сохранить наличие' }));

    await waitFor(() =>
      expect(api.post).toHaveBeenCalledWith('/admin/availability/confirm', {
        vendorId: 7,
        groups: [{ brandId: 1, weightId: 2, entries: [{ name: 'Needls', available: true }] }],
        wipeOthers: false,
      })
    );
    expect(onSaved).toHaveBeenCalled();
  });

  it('merges two screenshots of the same brand and weight into one list', async () => {
    vi.mocked(uploadAvailabilityImage)
      .mockResolvedValueOnce({
        detectedBrandName: 'DarkSide',
        brandId: 1,
        detectedGrams: 250,
        weightId: 2,
        entries: [{ name: 'Needls', available: true }],
      })
      .mockResolvedValueOnce({
        detectedBrandName: 'DarkSide',
        brandId: 1,
        detectedGrams: 250,
        weightId: 2,
        entries: [{ name: 'Ice Storm', available: true }],
      });

    const { user } = setup();
    await user.upload(screen.getByLabelText('Скрины наличия'), [shot('part1.jpg'), shot('part2.jpg')]);

    // One card, both flavours — a long list often does not fit in one screenshot.
    expect(await screen.findByText('2 вкусов')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Needls/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Ice Storm/ })).toBeInTheDocument();
  });

  it('asks for a brand when the screenshot showed one the catalogue does not have', async () => {
    vi.mocked(uploadAvailabilityImage).mockResolvedValue({
      detectedBrandName: 'Chabacco',
      brandId: null,
      detectedGrams: 250,
      weightId: 2,
      entries: [{ name: 'Lemon Pie', available: true }],
    });
    vi.mocked(api.post).mockResolvedValue({ id: 9, name: 'Chabacco' });

    const { user } = setup();
    await user.upload(screen.getByLabelText('Скрины наличия'), shot('chabacco.jpg'));

    // Prefilled with what the photo said, so saving creates it under that name.
    expect(await screen.findByLabelText('Название нового бренда')).toHaveValue('Chabacco');

    await user.click(screen.getByRole('button', { name: 'Сохранить наличие' }));

    await waitFor(() => expect(api.post).toHaveBeenCalledWith('/admin/brands', { name: 'Chabacco' }));
    expect(api.post).toHaveBeenCalledWith('/admin/availability/confirm', {
      vendorId: 7,
      groups: [{ brandId: 9, weightId: 2, entries: [{ name: 'Lemon Pie', available: true }] }],
      wipeOthers: false,
    });
  });

  it('will not save while a screenshot has no weight', async () => {
    vi.mocked(uploadAvailabilityImage).mockResolvedValue({
      detectedBrandName: 'DarkSide',
      brandId: 1,
      detectedGrams: null,
      weightId: null,
      entries: [{ name: 'Needls', available: true }],
    });

    const { user } = setup();
    await user.upload(screen.getByLabelText('Скрины наличия'), shot('cropped.jpg'));

    expect(await screen.findByRole('button', { name: 'Сохранить наличие' })).toBeDisabled();
    expect(screen.getByText('У каждого скрина должен быть бренд и граммовка.')).toBeInTheDocument();
  });

  it('warns what the wipe switch will do, and passes it on', async () => {
    vi.mocked(uploadAvailabilityImage).mockResolvedValue({
      detectedBrandName: 'DarkSide',
      brandId: 1,
      detectedGrams: 250,
      weightId: 2,
      entries: [{ name: 'Needls', available: true }],
    });

    const { user } = setup();
    await user.upload(screen.getByLabelText('Скрины наличия'), shot('darkside.jpg'));
    await user.click(await screen.findByRole('button', { name: /Убрать всё другое наличие/ }));

    expect(screen.getByText(/станет недоступным у Darian Shisha/)).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Сохранить наличие' }));
    await waitFor(() =>
      expect(api.post).toHaveBeenCalledWith(
        '/admin/availability/confirm',
        expect.objectContaining({ wipeOthers: true })
      )
    );
  });

  it('keeps the readable screenshots when one of them fails to parse', async () => {
    vi.mocked(uploadAvailabilityImage)
      .mockRejectedValueOnce(new Error('failed to parse availability image'))
      .mockResolvedValueOnce({
        detectedBrandName: 'DarkSide',
        brandId: 1,
        detectedGrams: 250,
        weightId: 2,
        entries: [{ name: 'Needls', available: true }],
      });

    const { user } = setup();
    await user.upload(screen.getByLabelText('Скрины наличия'), [shot('blurry.jpg'), shot('good.jpg')]);

    expect(await screen.findByText(/Не удалось распознать: blurry.jpg/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Needls/ })).toBeInTheDocument();
  });

  it('drops a screenshot the admin does not want', async () => {
    vi.mocked(uploadAvailabilityImage).mockResolvedValue({
      detectedBrandName: 'DarkSide',
      brandId: 1,
      detectedGrams: 250,
      weightId: 2,
      entries: [{ name: 'Needls', available: true }],
    });

    const { user } = setup();
    await user.upload(screen.getByLabelText('Скрины наличия'), shot('darkside.jpg'));
    await user.click(await screen.findByRole('button', { name: 'Убрать этот скрин' }));

    expect(screen.getByText('Скринов пока нет')).toBeInTheDocument();
  });

  it('lets the admin correct a misread flavour before saving', async () => {
    vi.mocked(uploadAvailabilityImage).mockResolvedValue({
      detectedBrandName: 'DarkSide',
      brandId: 1,
      detectedGrams: 250,
      weightId: 2,
      entries: [{ name: 'Needls', available: true }],
    });

    const { user } = setup();
    await user.upload(screen.getByLabelText('Скрины наличия'), shot('darkside.jpg'));
    await user.click(await screen.findByRole('button', { name: /Needls/ }));
    await user.click(screen.getByRole('button', { name: 'Сохранить наличие' }));

    await waitFor(() =>
      expect(api.post).toHaveBeenCalledWith(
        '/admin/availability/confirm',
        expect.objectContaining({
          groups: [{ brandId: 1, weightId: 2, entries: [{ name: 'Needls', available: false }] }],
        })
      )
    );
  });
});

describe('AvailabilityReview — the card the admin sees', () => {
  it('names the vendor it is about', async () => {
    setup();
    expect(within(screen.getByText('Наличие по фото').closest('.tb-card')!).getByText(/Darian Shisha/)).toBeInTheDocument();
  });
});
