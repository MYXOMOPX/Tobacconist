import { describe, it, expect } from 'vitest';
import { formatEur, formatKg, formatQty, gramsLabel, packPriceEur, sumEur } from './format';

describe('packPriceEur', () => {
  it('derives the pack price from €/kg and the weight', () => {
    expect(packPriceEur(42, 250)).toBe(10.5);
    expect(packPriceEur(42, 100)).toBe(4.2);
    expect(packPriceEur(38, 250)).toBe(9.5);
  });

  it('rounds to whole cents', () => {
    expect(packPriceEur(37.77, 250)).toBe(9.44);
  });
});

describe('sumEur', () => {
  it('adds cents without float drift', () => {
    expect(sumEur([10.5, 21, 28.5])).toBe(60);
    expect(sumEur([0.1, 0.2])).toBe(0.3);
  });

  it('is empty-safe', () => {
    expect(sumEur([])).toBe(0);
  });
});

describe('formatEur', () => {
  it('always shows two decimals', () => {
    expect(formatEur(49.5)).toBe('49.50');
    expect(formatEur(10)).toBe('10.00');
    expect(formatEur(0)).toBe('0.00');
  });
});

describe('formatKg', () => {
  it('shows kilograms with two decimals', () => {
    expect(formatKg(1.25)).toBe('1.25');
    expect(formatKg(0.5)).toBe('0.50');
  });
});

describe('formatQty', () => {
  it('prefixes the count so it reads as packs, not money', () => {
    expect(formatQty(3)).toBe('x3');
  });
});

describe('gramsLabel', () => {
  it('labels a weight in Russian', () => {
    expect(gramsLabel(100)).toBe('100г');
    expect(gramsLabel(250)).toBe('250г');
  });
});
