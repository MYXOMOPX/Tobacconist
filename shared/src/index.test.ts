import { describe, it, expect } from 'vitest';
import type { OrderDto, AggregateLineDto } from './index';

describe('shared DTO types', () => {
  it('OrderDto carries one of the four lifecycle statuses', () => {
    const order: OrderDto = {
      id: 1,
      vendorId: 1,
      vendorName: 'Vasya',
      status: 'ordering',
      createdAt: '2026-08-25T00:00:00.000Z',
      statusChangedAt: '2026-08-25T00:00:00.000Z',
    };
    expect(['ordering', 'awaiting_validation', 'done', 'rejected']).toContain(order.status);
  });

  it('AggregateLineDto carries quantity and totalEur', () => {
    const line: AggregateLineDto = {
      brandId: 1,
      brandName: 'DarkSide',
      flavorId: 1,
      flavorName: 'CyberKiwi',
      weightId: 1,
      grams: 250,
      quantity: 3,
      deliveredQty: null,
      totalEur: 15.75,
      available: true,
    };
    expect(line.quantity).toBe(3);
  });
});
