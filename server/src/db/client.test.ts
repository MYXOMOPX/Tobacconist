import { describe, it, expect, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import { createDb, createTestDb, closeDb, type Db } from './client';
import { weights, brands, orders, orderItems, orderParticipants } from './schema';

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

  /**
   * The live database predates the orders model, so booting the new code against
   * it has to carry the existing rounds over rather than start from nothing.
   */
  it('carries a legacy rounds database over to orders', async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tobacconist-legacy-'));
    const file = path.join(dir, 'data.sqlite');

    // A database as the previous release left it: schema from 0000 only, with an
    // open round, a closed one, order lines and a payment mark.
    const legacy = new Database(file);
    legacy.exec(
      fs.readFileSync(path.join(__dirname, 'migrations', '0000_init.sql'), 'utf-8')
    );
    legacy.exec(`
      INSERT INTO users (id, telegram_id, display_name, role, first_seen_at)
        VALUES (1, '1', 'Admin', 'admin', '2026-08-01'), (2, '2', 'Friend', 'member', '2026-08-01');
      INSERT INTO vendors (id, name, archived) VALUES (1, 'Vasya', 0);
      INSERT INTO brands (id, name) VALUES (1, 'DarkSide');
      INSERT INTO flavors (id, brand_id, name) VALUES (1, 1, 'CyberKiwi');
      INSERT INTO purchase_rounds (id, vendor_id, status, opened_at, closed_at, opened_by_user_id)
        VALUES (1, 1, 'closed', '2026-08-01', '2026-08-02', 1),
               (2, 1, 'open', '2026-08-03', NULL, 1);
      INSERT INTO round_brand_price_snapshots (round_id, brand_id, price_per_kg_eur) VALUES (1, 1, 20), (2, 1, 22);
      INSERT INTO order_items (id, round_id, user_id, brand_id, flavor_id, weight_id, quantity, created_at, updated_at)
        VALUES (1, 1, 2, 1, 1, 1, 3, '2026-08-01', '2026-08-01');
      INSERT INTO round_payments (round_id, user_id, paid, marked_at, marked_by_user_id) VALUES (1, 2, 1, '2026-08-02', 1);
      INSERT INTO delivery_checklist_items (round_id, brand_id, flavor_id, weight_id, expected_qty, received_qty)
        VALUES (1, 1, 1, 1, 3, 2);
    `);
    legacy.close();

    const db = createDb(file);
    opened.push(db);

    // A round that was still open is still collecting; a closed one is history,
    // which is what the old app already showed it as.
    const carried = await db.select().from(orders).all();
    expect(carried.map((order) => [order.id, order.status])).toEqual([
      [1, 'done'],
      [2, 'ordering'],
    ]);

    const items = await db.select().from(orderItems).all();
    expect(items[0]).toMatchObject({ orderId: 1, userId: 2, quantity: 3, deliveredQty: null, addedByUserId: 2 });

    const participants = await db.select().from(orderParticipants).all();
    expect(participants[0]).toMatchObject({ orderId: 1, userId: 2, paid: true, ready: false });
  });

  it('creates the folder the database file lives in', async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tobacconist-mkdir-'));
    // The default DB_PATH points into a `data/` that ships with nothing in it.
    const file = path.join(dir, 'data', 'tobacconist.sqlite3');

    const db = createDb(file);
    opened.push(db);

    expect(fs.existsSync(file)).toBe(true);
    expect((await db.select().from(weights).all()).length).toBe(2);
  });

  it('does not re-run a migration that already ran', async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tobacconist-twice-'));
    const file = path.join(dir, 'data.sqlite');

    const first = createDb(file);
    opened.push(first);
    await first.insert(brands).values({ name: 'DarkSide' }).run();

    const second = createDb(file);
    opened.push(second);

    // A second boot must not rebuild the tables and lose what is in them.
    expect(await second.select().from(brands).all()).toEqual([{ id: 1, name: 'DarkSide' }]);
  });
});
