import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ChecklistPage } from './ChecklistPage';
import { api } from '../apiClient';

vi.mock('../apiClient', () => ({ api: { get: vi.fn(), post: vi.fn(), put: vi.fn() } }));

const checklist = [
  {
    id: 11,
    brandId: 1,
    brandName: 'DarkSide',
    flavorId: 1,
    flavorName: 'CyberKiwi',
    weightId: 1,
    grams: 250,
    expectedQty: 3,
    receivedQty: 1,
  },
];

function mockApi() {
  vi.mocked(api.get).mockImplementation(async (path: string) => {
    if (path === '/orders/5/checklist') return checklist;
    return [];
  });
  vi.mocked(api.post).mockResolvedValue({});
}

describe('ChecklistPage', () => {
  it('shows what is expected and the received progress', async () => {
    mockApi();
    render(<ChecklistPage orderId={5} onBack={vi.fn()} onFinish={vi.fn()} />);

    expect(await screen.findByText('нужно 3')).toBeInTheDocument();
    expect(screen.getByText('DarkSide CyberKiwi')).toBeInTheDocument();
    expect(screen.getByText('1 / 3')).toBeInTheDocument();
  });

  it('saves the delivered count as soon as the stepper changes', async () => {
    mockApi();
    const user = userEvent.setup();
    render(<ChecklistPage orderId={5} onBack={vi.fn()} onFinish={vi.fn()} />);

    await user.click(
      await screen.findByRole('button', { name: /Добавить одну пачку: DarkSide CyberKiwi 250г/ })
    );

    await waitFor(() =>
      expect(api.post).toHaveBeenCalledWith('/orders/5/checklist/11/adjust', { delta: 1 })
    );
  });

  it('finishes the order from here', async () => {
    mockApi();
    const onFinish = vi.fn();
    const user = userEvent.setup();
    render(<ChecklistPage orderId={5} onBack={vi.fn()} onFinish={onFinish} />);

    await user.click(await screen.findByRole('button', { name: 'Завершить заказ' }));
    expect(onFinish).toHaveBeenCalled();
  });

  it('goes back to the order screen', async () => {
    mockApi();
    const onBack = vi.fn();
    const user = userEvent.setup();
    render(<ChecklistPage orderId={5} onBack={onBack} onFinish={vi.fn()} />);

    await user.click(await screen.findByRole('button', { name: '← К заказу' }));
    expect(onBack).toHaveBeenCalled();
  });
});
