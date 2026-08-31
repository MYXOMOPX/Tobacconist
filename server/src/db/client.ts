import Database from 'better-sqlite3';
import { sql } from 'drizzle-orm';
import { drizzle, type BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as schema from './schema.js';

export type Db = BetterSQLite3Database<typeof schema>;

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * Applies every migration file once, in filename order, recording what ran in
 * `schema_migrations`. The first migration is idempotent (CREATE IF NOT EXISTS)
 * but later ones rebuild tables, so they must not run twice.
 *
 * Foreign keys are off while migrating: a table rebuild drops and renames tables
 * that other tables reference, which the checker would otherwise reject.
 */
function applyMigrations(sqlite: Database.Database) {
  sqlite.exec(
    `CREATE TABLE IF NOT EXISTS schema_migrations (
       name TEXT PRIMARY KEY,
       applied_at TEXT NOT NULL
     )`
  );

  const dir = path.join(__dirname, 'migrations');
  const files = fs.readdirSync(dir).filter((name) => name.endsWith('.sql')).sort();
  const applied = new Set(
    sqlite
      .prepare('SELECT name FROM schema_migrations')
      .all()
      .map((row) => (row as { name: string }).name)
  );

  const foreignKeysWereOn = sqlite.pragma('foreign_keys', { simple: true }) === 1;
  if (foreignKeysWereOn) sqlite.pragma('foreign_keys = OFF');
  try {
    for (const file of files) {
      if (applied.has(file)) continue;
      sqlite.exec('BEGIN');
      try {
        sqlite.exec(fs.readFileSync(path.join(dir, file), 'utf-8'));
        sqlite
          .prepare('INSERT INTO schema_migrations (name, applied_at) VALUES (?, ?)')
          .run(file, new Date().toISOString());
        sqlite.exec('COMMIT');
      } catch (err) {
        sqlite.exec('ROLLBACK');
        throw err;
      }
    }
  } finally {
    if (foreignKeysWereOn) sqlite.pragma('foreign_keys = ON');
  }
}

/** Lets callers (mainly tests) release the underlying file handle. */
const drivers = new WeakMap<object, Database.Database>();

export function createDb(filePath: string): Db {
  const sqlite = new Database(filePath);
  sqlite.pragma('journal_mode = WAL');
  sqlite.pragma('foreign_keys = ON');
  applyMigrations(sqlite);
  const db = drizzle(sqlite, { schema });
  drivers.set(db, sqlite);
  return db;
}

export function createTestDb(): Db {
  const sqlite = new Database(':memory:');
  sqlite.pragma('foreign_keys = ON');
  applyMigrations(sqlite);
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

export * as schema from './schema.js';
