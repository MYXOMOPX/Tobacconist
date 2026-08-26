import Database from 'better-sqlite3';
import { sql } from 'drizzle-orm';
import { drizzle, type BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as schema from './schema';

export type Db = BetterSQLite3Database<typeof schema>;

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function applyMigration(sqlite: Database.Database) {
  const sql = fs.readFileSync(
    path.join(__dirname, 'migrations', '0000_init.sql'),
    'utf-8'
  );
  sqlite.exec(sql);
}

/** Lets callers (mainly tests) release the underlying file handle. */
const drivers = new WeakMap<object, Database.Database>();

export function createDb(filePath: string): Db {
  const sqlite = new Database(filePath);
  sqlite.pragma('journal_mode = WAL');
  sqlite.pragma('foreign_keys = ON');
  applyMigration(sqlite);
  const db = drizzle(sqlite, { schema });
  drivers.set(db, sqlite);
  return db;
}

export function createTestDb(): Db {
  const sqlite = new Database(':memory:');
  sqlite.pragma('foreign_keys = ON');
  applyMigration(sqlite);
  const db = drizzle(sqlite, { schema });
  drivers.set(db, sqlite);
  return db;
}

export function closeDb(db: Db): void {
  drivers.get(db)?.close();
  drivers.delete(db);
}

/**
 * Runs `fn` inside a single SQLite transaction, rolling back if it throws.
 *
 * Drizzle's own `db.transaction()` only accepts a synchronous callback on the
 * better-sqlite3 (sync) driver, so it cannot wrap our `async` domain functions —
 * it would commit before their promises settle. better-sqlite3 executes every
 * statement synchronously on a single connection, so explicit BEGIN/COMMIT
 * around awaited domain calls is equivalent and safe here.
 */
export async function runInTransaction<T>(db: Db, fn: () => Promise<T>): Promise<T> {
  db.run(sql`BEGIN`);
  try {
    const result = await fn();
    db.run(sql`COMMIT`);
    return result;
  } catch (err) {
    db.run(sql`ROLLBACK`);
    throw err;
  }
}

export * as schema from './schema';
