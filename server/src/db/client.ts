import Database from 'better-sqlite3';
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

export function createDb(filePath: string): Db {
  const sqlite = new Database(filePath);
  sqlite.pragma('journal_mode = WAL');
  sqlite.pragma('foreign_keys = ON');
  applyMigration(sqlite);
  return drizzle(sqlite, { schema });
}

export function createTestDb(): Db {
  const sqlite = new Database(':memory:');
  sqlite.pragma('foreign_keys = ON');
  applyMigration(sqlite);
  return drizzle(sqlite, { schema });
}

export * as schema from './schema';
