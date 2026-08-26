import { describe, it, expect } from 'vitest';
import type { AggregateLine } from './summary';
import { buildTextSnapshot, buildTableSnapshot } from './snapshot';

const lines: AggregateLine[] = [
  { brandId: 1, brandName: 'DarkSide', flavorId: 1, flavorName: 'CyberKiwi', weightId: 1, grams: 250, quantity: 3, totalEur: 15 },
  { brandId: 1, brandName: 'DarkSide', flavorId: 1, flavorName: 'CyberKiwi', weightId: 2, grams: 100, quantity: 2, totalEur: 4 },
  { brandId: 2, brandName: 'Chabacco', flavorId: 2, flavorName: 'Lemon Pie', weightId: 1, grams: 250, quantity: 1, totalEur: 5 },
];

describe('buildTextSnapshot', () => {
  it('groups by brand alphabetically and formats "Brand - Flavor - Weight - xQty"', () => {
    const text = buildTextSnapshot(lines);
    expect(text).toBe(
      [
        'Chabacco',
        'Chabacco - Lemon Pie - 250g - x1',
        '',
        'DarkSide',
        'DarkSide - CyberKiwi - 100g - x2',
        'DarkSide - CyberKiwi - 250g - x3',
      ].join('\n')
    );
  });
});

describe('buildTableSnapshot', () => {
  it('flattens lines into row objects sorted the same way', () => {
    const table = buildTableSnapshot(lines);
    expect(table).toEqual([
      { brand: 'Chabacco', flavor: 'Lemon Pie', weight: '250g', quantity: 1, totalEur: 5 },
      { brand: 'DarkSide', flavor: 'CyberKiwi', weight: '100g', quantity: 2, totalEur: 4 },
      { brand: 'DarkSide', flavor: 'CyberKiwi', weight: '250g', quantity: 3, totalEur: 15 },
    ]);
  });
});
