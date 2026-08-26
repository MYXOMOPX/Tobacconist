import { describe, it, expect, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createDb, createTestDb, closeDb, type Db } from './client';
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

describe('createDb against a persistent file', () => {
  let dir: string | null = null;
  const opened: Db[] = [];

  afterEach(() => {
    for (const db of opened.splice(0)) closeDb(db);
    if (dir) fs.rmSync(dir, { recursive: true, force: true });
    dir = null;
  });

  it('is safely re-runnable: a second boot against the same file neither throws nor re-seeds', async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tobacconist-db-'));
    const file = path.join(dir, 'data.sqlite');

    const first = createDb(file);
    opened.push(first);
    expect((await first.select().from(weights).all()).length).toBe(2);

    // Second boot (e.g. container restart against a persistent volume)
    let second: Db | undefined;
    expect(() => {
      second = createDb(file);
    }).not.toThrow();
    opened.push(second!);

    const rows = await second!.select().from(weights).all();
    expect(rows.map((r) => r.grams).sort((a, b) => a - b)).toEqual([100, 250]);
  });
});
