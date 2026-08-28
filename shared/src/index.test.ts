import { describe, it, expect } from 'vitest';
import type { RoundDto, AggregateLineDto } from './index';

describe('shared DTO types', () => {
  it('RoundDto has status open|closed', () => {
    const round: RoundDto = {
      id: 1,
      vendorId: 1,
      vendorName: 'Vasya',
      status: 'open',
      openedAt: '2026-08-25T00:00:00.000Z',
      closedAt: null,
    };
    expect(round.status === 'open' || round.status === 'closed').toBe(true);
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
      totalEur: 15.75,
      available: true,
    };
    expect(line.quantity).toBe(3);
  });
});
