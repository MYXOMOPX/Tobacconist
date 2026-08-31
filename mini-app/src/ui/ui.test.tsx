import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {
  LedgerRow,
  Money,
  StatusBadge,
  Stepper,
  TabBar,
  Toggle,
  Weight,
  type OrderStatus,
} from './index';

describe('StatusBadge', () => {
  it('names every status in Russian', () => {
    const cases: [OrderStatus, string][] = [
      ['ordering', 'Сбор заказов'],
      ['awaiting_validation', 'На сверке'],
      ['done', 'Завершён'],
      ['rejected', 'Отменён'],
    ];
    for (const [status, label] of cases) {
      const { unmount } = render(<StatusBadge status={status} />);
      expect(screen.getByText(label)).toBeInTheDocument();
      unmount();
    }
  });

  it('fills active statuses and outlines terminal ones', () => {
    render(
      <>
        <StatusBadge status="ordering" />
        <StatusBadge status="awaiting_validation" />
        <StatusBadge status="done" />
        <StatusBadge status="rejected" />
      </>,
    );
    expect(screen.getByText('Сбор заказов')).toHaveClass('tb-badge--ordering');
    expect(screen.getByText('На сверке')).toHaveClass('tb-badge--awaiting');
    expect(screen.getByText('Завершён')).toHaveClass('tb-badge--done');
    expect(screen.getByText('Отменён')).toHaveClass('tb-badge--rejected');
  });
});

describe('Money and Weight', () => {
  it('prints two decimals next to the unit', () => {
    render(
      <>
        <Money value={49.5} />
        <Weight kg={1.25} />
      </>,
    );
    expect(screen.getByText('49.50')).toBeInTheDocument();
    expect(screen.getByText('€')).toBeInTheDocument();
    expect(screen.getByText('1.25')).toBeInTheDocument();
    expect(screen.getByText('кг')).toBeInTheDocument();
  });
});

describe('Stepper', () => {
  it('adds and removes one pack at a time', async () => {
    const onChange = vi.fn();
    render(<Stepper value={2} onChange={onChange} label="Needls 250г" />);

    await userEvent.click(screen.getByRole('button', { name: /Добавить одну пачку/ }));
    expect(onChange).toHaveBeenCalledWith(3);

    await userEvent.click(screen.getByRole('button', { name: /Убрать одну пачку/ }));
    expect(onChange).toHaveBeenCalledWith(1);
  });

  it('cannot go below the minimum', () => {
    render(<Stepper value={0} onChange={vi.fn()} label="Needls 250г" />);
    expect(screen.getByRole('button', { name: /Убрать одну пачку/ })).toBeDisabled();
  });

  it('is fully disabled once the order is on validation', () => {
    render(<Stepper value={2} onChange={vi.fn()} label="Needls 250г" disabled />);
    expect(screen.getByRole('button', { name: /Добавить одну пачку/ })).toBeDisabled();
    expect(screen.getByRole('button', { name: /Убрать одну пачку/ })).toBeDisabled();
  });
});

describe('LedgerRow', () => {
  it('shows the pack count and the line total', () => {
    render(<LedgerRow name="Needls" meta="250г" quantity={2} amount={21} />);
    expect(screen.getByText('Needls')).toBeInTheDocument();
    expect(screen.getByText('250г')).toBeInTheDocument();
    expect(screen.getByText('x2')).toBeInTheDocument();
    expect(screen.getByText('21.00')).toBeInTheDocument();
  });

  it('marks a position that is no longer stocked', () => {
    const { container } = render(<LedgerRow name="Wild Fire" meta="250г" quantity={1} unavailable />);
    expect(container.querySelector('.tb-ledger--unavailable')).not.toBeNull();
  });
});

describe('Toggle', () => {
  it('reports the payment mark it would set', async () => {
    const onChange = vi.fn();
    render(<Toggle label="Оплачено" pressed={false} onChange={onChange} />);
    await userEvent.click(screen.getByRole('button', { name: /Оплачено/ }));
    expect(onChange).toHaveBeenCalledWith(true);
  });
});

describe('TabBar', () => {
  it('marks the open section for screen readers', async () => {
    const onSelect = vi.fn();
    render(
      <TabBar
        items={[
          { id: 'orders', label: 'Заказы' },
          { id: 'history', label: 'История' },
        ]}
        active="orders"
        onSelect={onSelect}
      />,
    );
    expect(screen.getByRole('button', { name: 'Заказы' })).toHaveAttribute('aria-current', 'page');
    await userEvent.click(screen.getByRole('button', { name: 'История' }));
    expect(onSelect).toHaveBeenCalledWith('history');
  });
});
