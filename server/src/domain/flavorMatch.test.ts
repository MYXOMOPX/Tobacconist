import { describe, expect, it } from 'vitest';
import {
  damerauLevenshtein,
  matchFlavor,
  maxTypoDistance,
  normalizeFlavorName,
  resolveEntries,
} from './flavorMatch.js';

describe('normalizeFlavorName', () => {
  it('ignores case, spaces and punctuation', () => {
    expect(normalizeFlavorName(' Fruity  Dust! ')).toBe('fruitydust');
  });
  it('folds Cyrillic lookalikes onto Latin', () => {
    expect(normalizeFlavorName('FRUITАLITY')).toBe(normalizeFlavorName('FRUITALITY'));
  });
});

describe('damerauLevenshtein', () => {
  it('counts a neighbour swap as one edit', () => {
    expect(damerauLevenshtein('fruitality', 'fruitailty')).toBe(1);
  });
  it('counts insertions and substitutions', () => {
    expect(damerauLevenshtein('kitten', 'sitting')).toBe(3);
    expect(damerauLevenshtein('', 'abc')).toBe(3);
  });
});

describe('maxTypoDistance', () => {
  it('allows nothing for very short names, more for long ones', () => {
    expect([4, 5, 8, 9, 10, 20].map(maxTypoDistance)).toEqual([0, 1, 1, 2, 3, 6]);
  });
});

describe('matchFlavor', () => {
  it('finds an exact spelling regardless of case', () => {
    expect(matchFlavor('fruity dust', ['FRUITY DUST'])).toEqual({ kind: 'exact', name: 'FRUITY DUST' });
  });
  it('finds a typo', () => {
    expect(matchFlavor('FRUITTALLLITY', ['FRUITALITY'])).toMatchObject({ kind: 'near', name: 'FRUITALITY' });
  });
  it('does not merge short different flavours', () => {
    expect(matchFlavor('MIST', ['MINT']).kind).toBe('none');
  });
  it('reports a tie as ambiguous', () => {
    expect(matchFlavor('CHERRY X', ['CHERRY A', 'CHERRY B'])).toMatchObject({ kind: 'ambiguous' });
  });
});

describe('resolveEntries', () => {
  it('snaps to a known spelling and remembers the original', () => {
    expect(resolveEntries([{ name: 'FRUITTALLLITY', available: true }], ['FRUITALITY'])).toEqual([
      { name: 'FRUITALITY', available: true, originalName: 'FRUITTALLLITY', checkWith: ['FRUITALITY'] },
    ]);
  });
  it('merges typos inside one batch, first spelling wins', () => {
    const out = resolveEntries(
      [
        { name: 'FRUITALITY', available: true },
        { name: 'FRUITTALLLITY', available: false },
      ],
      []
    );
    expect(out).toEqual([{ name: 'FRUITALITY', available: true, originalName: 'FRUITTALLLITY' }]);
  });
  it('merges exact duplicates, in stock if either is', () => {
    const out = resolveEntries(
      [
        { name: 'FRUITY DUST', available: false },
        { name: 'FRUITY DUST', available: true },
      ],
      []
    );
    expect(out).toEqual([{ name: 'FRUITY DUST', available: true }]);
  });
  it('keeps unrelated flavours apart', () => {
    expect(
      resolveEntries([{ name: 'MINT', available: true }, { name: 'MIST', available: true }], [])
    ).toHaveLength(2);
  });
});
