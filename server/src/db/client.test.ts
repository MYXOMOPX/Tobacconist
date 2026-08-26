import { describe, it, expect } from 'vitest';
import { createTestDb } from './client';
import { weights, brands } from './schema';

describe('createTestDb', () => {
  it('applies the migration and seeds fixed weights', async () => {
    const db = createTestDb();
    const rows = await db.select().from(weights).all();
    expect(rows.map((r) => r.grams).sort((a, b) => a - b)).toEqual([100, 250]);
  });

  it('allows inserting and reading a brand', async () => {
    const db = createTestDb();
    await db.insert(brands).values({ name: 'DarkSide' }).run();
    const rows = await db.select().from(brands).all();
    expect(rows).toEqual([{ id: 1, name: 'DarkSide' }]);
  });
});
