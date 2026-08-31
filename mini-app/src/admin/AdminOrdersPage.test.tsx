import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AdminOrdersPage } from './AdminOrdersPage';
import { api } from '../apiClient';

vi.mock('../apiClient', () => ({ api: { get: vi.fn(), post: vi.fn(), put: vi.fn() } }));

const vasyaOrder = {
  id: 5,
  vendorId: 1,
  vendorName: 'Vasya',
  status: 'ordering',
  createdAt: '',
  statusChangedAt: '',
};

const vendors = [
  { id: 1, name: 'Vasya', archived: false },
  { id: 2, name: 'Petya', archived: false },
  { id: 3, name: 'OldSupplier', archived: true },
];

function mockApi(orders: unknown[] = [vasyaOrder]) {
  vi.mocked(api.get).mockImplementation(async (path: string) => {
    if (path === '/orders') return orders;
    if (path === '/admin/vendors') return vendors;
    return [];
  });
}

describe('AdminOrdersPage', () => {
  it('lists the active orders with their status', async () => {
    mockApi();
    render(<AdminOrdersPage onOpen={vi.fn()} />);

    const row = (await screen.findByText('Vasya')).closest('button');
    expect(row).toHaveTextContent('Заказ #5');
    expect(row).toHaveTextContent('Сбор заказов');
  });

  it('says what to do when nothing is open yet', async () => {
    mockApi([]);
    render(<AdminOrdersPage onOpen={vi.fn()} />);
    expect(await screen.findByText('Активных заказов нет')).toBeInTheDocument();
  });

  it('opens a new order at a free vendor', async () => {
    mockApi();
    vi.mocked(api.post).mockResolvedValue({ ...vasyaOrder, id: 7, vendorId: 2, vendorName: 'Petya' });
    const onOpen = vi.fn();
    const user = userEvent.setup();
    render(<AdminOrdersPage onOpen={onOpen} />);

    await user.click(await screen.findByRole('button', { name: 'Новый заказ' }));
    await user.click(await screen.findByRole('button', { name: /Petya/ }));

    expect(api.post).toHaveBeenCalledWith('/orders', { vendorId: 2 });
    await waitFor(() => expect(onOpen).toHaveBeenCalledWith(7));
  });

  it('blocks a vendor that already has an active order, and hides archived ones', async () => {
    mockApi();
    const user = userEvent.setup();
    render(<AdminOrdersPage onOpen={vi.fn()} />);

    await user.click(await screen.findByRole('button', { name: 'Новый заказ' }));

    // Vasya also appears in the list behind the sheet — check the picker itself.
    const sheet = within(await screen.findByRole('dialog'));
    const taken = sheet.getByRole('button', { name: /Vasya/ });
    expect(taken).toBeDisabled();
    expect(taken).toHaveTextContent('уже есть активный заказ');
    expect(sheet.queryByText('OldSupplier')).not.toBeInTheDocument();
  });

  it('shows the error message when opening an order fails', async () => {
    mockApi([]);
    vi.mocked(api.post).mockRejectedValue(new Error('this vendor already has an active order'));
    const user = userEvent.setup();
    render(<AdminOrdersPage onOpen={vi.fn()} />);

    await user.click(await screen.findByRole('button', { name: 'Новый заказ' }));
    await user.click(await screen.findByRole('button', { name: /Vasya/ }));

    expect(await screen.findByRole('alert')).toHaveTextContent('already has an active order');
  });
});
