import { describe, it, expect } from 'vitest';
import { createTestDb } from '../db/client';
import { packPriceEur, getWeights, createBrand, listBrands, findOrCreateFlavor, listFlavorsByBrand, matchBrandByName, findOrCreateBrand, importFlavorList } from './catalog';

describe('packPriceEur', () => {
  it('computes pack price from €/kg and grams', () => {
    expect(packPriceEur(20, 250)).toBeCloseTo(5.0);
    expect(packPriceEur(20, 100)).toBeCloseTo(2.0);
  });
});

describe('catalog domain', () => {
  it('getWeights returns the seeded fixed set', async () => {
    const db = createTestDb();
    const w = await getWeights(db);
    expect(w.map((x) => x.grams).sort((a, b) => a - b)).toEqual([100, 250]);
  });

  it('createBrand + listBrands round-trips', async () => {
    const db = createTestDb();
    await createBrand(db, 'DarkSide');
    const brands = await listBrands(db);
    expect(brands.map((b) => b.name)).toEqual(['DarkSide']);
  });

  it('findOrCreateFlavor creates once and reuses on repeat calls', async () => {
    const db = createTestDb();
    const brand = await createBrand(db, 'DarkSide');
    const first = await findOrCreateFlavor(db, brand.id, 'CyberKiwi');
    const second = await findOrCreateFlavor(db, brand.id, 'CyberKiwi');
    expect(second.id).toBe(first.id);
    const flavors = await listFlavorsByBrand(db, brand.id);
    expect(flavors).toHaveLength(1);
  });
});

describe('matchBrandByName', () => {
  it('matches ignoring case, spaces and punctuation', async () => {
    const db = createTestDb();
    await createBrand(db, 'DarkSide');
    expect((await matchBrandByName(db, 'dark side'))?.name).toBe('DarkSide');
    expect((await matchBrandByName(db, 'DARK-SIDE'))?.name).toBe('DarkSide');
  });

  it('matches a heading that carries the product line too', async () => {
    const db = createTestDb();
    await createBrand(db, 'DarkSide');
    // What vision actually returned from a real screenshot.
    expect((await matchBrandByName(db, 'DARKSIDE CORE'))?.name).toBe('DarkSide');
  });

  it('prefers the longest overlap when several brands could match', async () => {
    const db = createTestDb();
    await createBrand(db, 'Must');
    await createBrand(db, 'MustHave');
    expect((await matchBrandByName(db, 'MustHave Premium'))?.name).toBe('MustHave');
  });

  it('returns null rather than guessing, so the admin decides', async () => {
    const db = createTestDb();
    await createBrand(db, 'DarkSide');
    expect(await matchBrandByName(db, 'Chabacco')).toBeNull();
    expect(await matchBrandByName(db, '   ')).toBeNull();
  });
});

describe('findOrCreateBrand', () => {
  it('does not duplicate a brand that already exists', async () => {
    const db = createTestDb();
    const first = await findOrCreateBrand(db, 'DarkSide');
    const second = await findOrCreateBrand(db, ' DarkSide ');
    expect(second.id).toBe(first.id);
  });
});

describe('flavour matching in the catalogue', () => {
  it('does not create a second row for a respelled or mistyped flavour', async () => {
    const db = createTestDb();
    const brand = await createBrand(db, 'Test');
    const first = await findOrCreateFlavor(db, brand.id, 'FRUITALITY');
    expect((await findOrCreateFlavor(db, brand.id, 'fruitality ')).id).toBe(first.id);
    expect((await findOrCreateFlavor(db, brand.id, 'FRUITALITLY')).id).toBe(first.id);
    expect(await listFlavorsByBrand(db, brand.id)).toHaveLength(1);
  });

  it('imports a list, skipping what is already known', async () => {
    const db = createTestDb();
    const brand = await createBrand(db, 'Test');
    await findOrCreateFlavor(db, brand.id, 'MINT');
    const result = await importFlavorList(db, brand.id, 'MINT\nCherry Rocks\r\n\n cherry rocks');
    expect(result).toEqual({ added: ['Cherry Rocks'], skipped: ['MINT', 'cherry rocks'] });
  });
});
