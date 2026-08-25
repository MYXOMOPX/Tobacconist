# Tobacconist Group-Buy System Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a Telegram bot + Mini App that lets a single admin run group tobacco purchase rounds with friends: manage vendor catalog/prices/availability (availability parsed from photos via Gemini vision), collect structured orders through a Mini App, generate a supplier-ready snapshot, track delivery reconciliation and payments.

**Architecture:** Node.js/TypeScript monolith on a single VPS. One Fastify HTTP server serves (a) a REST API backed by SQLite via Drizzle ORM, (b) the built Mini App static bundle, and (c) the grammY Telegram bot webhook. A React+Vite Mini App (served by the same server) is the only order-entry UI; the bot only handles round-start commands and admin notifications. Traefik terminates HTTPS in front of the Node process.

**Tech Stack:** TypeScript, Fastify, Drizzle ORM + better-sqlite3, grammY, @google/generative-ai (Gemini vision), exceljs, React + Vite, Vitest (+ @testing-library/react for Mini App), npm workspaces monorepo.

**Spec:** `docs/superpowers/specs/2026-08-25-tobacconist-group-buy-design.md`

## Global Constraints

- All money values are EUR only, no currency conversion (spec §11 / out-of-scope §14).
- Weight options are a fixed, extensible-in-DB set seeded with 100g and 250g (spec §3).
- Price is per brand, €/kg; pack price = `pricePerKgEur * grams / 1000`, independent of flavor (spec §3-4).
- A round's calculations always use the price snapshot taken at `openRound` time, never live prices (spec §3, §5).
- Only one `open` `PurchaseRound` may exist at a time (spec §5).
- Uploading a new availability image for a (vendor, brand, weight) fully replaces prior availability for that triple — absent flavors become unavailable (spec §4).
- Order items for now-unavailable flavors are never silently deleted, only flagged (spec §4, §12).
- Reopening a closed round preserves already-entered `receivedQty` on checklist items that still match after recompute (spec §5, §7).
- All API access requires a valid Telegram `initData` signature AND current membership in the configured group chat (spec §2, §12); admin-only routes additionally require the configured admin Telegram id.
- No free-text/AI order parsing — Mini App is the only order-entry surface (spec §14).
- Single admin only, id from config (spec §2, §12).

---

## File Structure

```
/package.json                          # npm workspaces root
/tsconfig.base.json
/shared/
  package.json
  src/index.ts                         # DTO types shared by server & mini-app
/server/
  package.json
  tsconfig.json
  vitest.config.ts
  src/
    config.ts
    db/
      schema.ts
      migrations/0000_init.sql
      client.ts
    domain/
      catalog.ts
      vendors.ts
      availability.ts
      rounds.ts
      orders.ts
      summary.ts
      checklist.ts
      payments.ts
      snapshot.ts
      xlsx.ts
    gemini/
      client.ts
      availabilityParser.ts
    telegram/
      auth.ts
      bot.ts
      notify.ts
    api/
      app.ts
      middleware/authenticate.ts
      routes/
        catalog.ts
        availability.ts
        rounds.ts
        orders.ts
        snapshot.ts
        checklist.ts
        payments.ts
        history.ts
    index.ts
/mini-app/
  package.json
  vite.config.ts
  tsconfig.json
  src/
    main.tsx
    telegram.ts
    apiClient.ts
    admin/
      VendorPricesPage.tsx
      AvailabilityUploadPage.tsx
      RoundControlPage.tsx
      SnapshotPage.tsx
      ChecklistPage.tsx
      PaymentsPage.tsx
    participant/
      OrderBuilderPage.tsx
      HistoryPage.tsx
/deploy/
  docker-compose.yml
  .env.example
  scripts/set-webhook.sh
```

---

### Task 1: Monorepo scaffold & shared DTO types

**Files:**
- Create: `package.json` (root)
- Create: `tsconfig.base.json`
- Create: `shared/package.json`
- Create: `shared/tsconfig.json`
- Create: `shared/src/index.ts`
- Test: `shared/src/index.test.ts`

**Interfaces:**
- Produces: `Weight`, `Brand`, `Flavor`, `Vendor`, `VendorBrandPriceDto`, `AvailabilityLineDto`, `AggregateLineDto`, `UserSummaryDto`, `RoundDto`, `ChecklistItemDto`, `PaymentDto` — TS types re-exported from `shared/src/index.ts`, imported by both `server` and `mini-app` as `@tobacconist/shared`.

- [ ] **Step 1: Create root workspace `package.json`**

```json
{
  "name": "tobacconist",
  "private": true,
  "workspaces": ["shared", "server", "mini-app"],
  "scripts": {
    "test": "npm run test --workspaces --if-present",
    "build": "npm run build --workspaces --if-present"
  }
}
```

- [ ] **Step 2: Create `tsconfig.base.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "resolveJsonModule": true,
    "forceConsistentCasingInFileNames": true
  }
}
```

- [ ] **Step 3: Create `shared/package.json` and `shared/tsconfig.json`**

`shared/package.json`:
```json
{
  "name": "@tobacconist/shared",
  "version": "0.0.1",
  "type": "module",
  "main": "src/index.ts",
  "types": "src/index.ts",
  "scripts": {
    "test": "vitest run"
  },
  "devDependencies": {
    "typescript": "^5.5.0",
    "vitest": "^2.0.0"
  }
}
```

`shared/tsconfig.json`:
```json
{
  "extends": "../tsconfig.base.json",
  "include": ["src"],
  "compilerOptions": { "outDir": "dist" }
}
```

- [ ] **Step 4: Write the failing test for the DTO shapes**

```typescript
// shared/src/index.test.ts
import { describe, it, expect } from 'vitest';
import type { RoundDto, AggregateLineDto } from './index';

describe('shared DTO types', () => {
  it('RoundDto has status open|closed', () => {
    const round: RoundDto = {
      id: 1,
      vendorId: 1,
      vendorName: 'Vasya',
      status: 'open',
      openedAt: '2026-08-25T00:00:00.000Z',
      closedAt: null,
    };
    expect(round.status === 'open' || round.status === 'closed').toBe(true);
  });

  it('AggregateLineDto carries quantity and totalEur', () => {
    const line: AggregateLineDto = {
      brandId: 1,
      brandName: 'DarkSide',
      flavorId: 1,
      flavorName: 'CyberKiwi',
      weightId: 1,
      grams: 250,
      quantity: 3,
      totalEur: 15.75,
    };
    expect(line.quantity).toBe(3);
  });
});
```

- [ ] **Step 5: Run test to verify it fails**

Run: `npm install && npm run test --workspace=shared`
Expected: FAIL — `./index` has no exported member `RoundDto` (module doesn't exist yet)

- [ ] **Step 6: Write `shared/src/index.ts`**

```typescript
export type Weight = { id: number; grams: number };

export type Brand = { id: number; name: string };

export type Flavor = { id: number; brandId: number; name: string };

export type Vendor = { id: number; name: string; archived: boolean };

export type VendorBrandPriceDto = {
  vendorId: number;
  brandId: number;
  brandName: string;
  pricePerKgEur: number;
};

export type AvailabilityLineDto = {
  flavorId: number;
  flavorName: string;
  weightId: number;
  grams: number;
  available: boolean;
};

export type AggregateLineDto = {
  brandId: number;
  brandName: string;
  flavorId: number;
  flavorName: string;
  weightId: number;
  grams: number;
  quantity: number;
  totalEur: number;
};

export type UserSummaryDto = {
  userId: number;
  displayName: string;
  items: AggregateLineDto[];
  totalKg: number;
  totalEur: number;
  paid: boolean;
  hasUnavailableItems: boolean;
};

export type RoundDto = {
  id: number;
  vendorId: number;
  vendorName: string;
  status: 'open' | 'closed';
  openedAt: string;
  closedAt: string | null;
};

export type ChecklistItemDto = {
  id: number;
  brandId: number;
  brandName: string;
  flavorId: number;
  flavorName: string;
  weightId: number;
  grams: number;
  expectedQty: number;
  receivedQty: number;
};

export type PaymentDto = {
  userId: number;
  displayName: string;
  paid: boolean;
};
```

- [ ] **Step 7: Run test to verify it passes**

Run: `npm run test --workspace=shared`
Expected: PASS (2 tests)

- [ ] **Step 8: Commit**

```bash
git add package.json tsconfig.base.json shared/
git commit -m "chore: scaffold monorepo and shared DTO types"
```

---

### Task 2: Database schema, migration, and client

**Files:**
- Create: `server/package.json`
- Create: `server/tsconfig.json`
- Create: `server/vitest.config.ts`
- Create: `server/src/db/schema.ts`
- Create: `server/src/db/migrations/0000_init.sql`
- Create: `server/src/db/client.ts`
- Test: `server/src/db/client.test.ts`

**Interfaces:**
- Consumes: nothing (foundation task)
- Produces: `createDb(filePath: string): Db`, `createTestDb(): Db`, `type Db = BetterSQLite3Database<typeof schema>`, and the full `schema` module (`users`, `weights`, `brands`, `flavors`, `vendors`, `vendorBrandPrices`, `vendorFlavorAvailability`, `availabilityUploads`, `purchaseRounds`, `roundBrandPriceSnapshots`, `orderItems`, `roundPayments`, `deliveryChecklistItems`) — all later tasks import `createTestDb`/`createDb` and table objects from `server/src/db/client.ts` and `server/src/db/schema.ts`.

- [ ] **Step 1: Create `server/package.json`, `server/tsconfig.json`, `server/vitest.config.ts`**

`server/package.json`:
```json
{
  "name": "@tobacconist/server",
  "version": "0.0.1",
  "type": "module",
  "scripts": {
    "test": "vitest run",
    "build": "tsc -p tsconfig.json",
    "start": "node dist/index.js"
  },
  "dependencies": {
    "@tobacconist/shared": "*",
    "better-sqlite3": "^11.3.0",
    "drizzle-orm": "^0.33.0",
    "fastify": "^4.28.0",
    "@fastify/multipart": "^8.3.0",
    "@fastify/static": "^7.0.4",
    "grammy": "^1.28.0",
    "@google/generative-ai": "^0.17.0",
    "exceljs": "^4.4.0"
  },
  "devDependencies": {
    "@types/better-sqlite3": "^7.6.11",
    "@types/node": "^20.14.0",
    "typescript": "^5.5.0",
    "vitest": "^2.0.0",
    "drizzle-kit": "^0.24.0"
  }
}
```

`server/tsconfig.json`:
```json
{
  "extends": "../tsconfig.base.json",
  "include": ["src"],
  "compilerOptions": { "outDir": "dist", "rootDir": "src" }
}
```

`server/vitest.config.ts`:
```typescript
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: { environment: 'node' },
});
```

- [ ] **Step 2: Write `server/src/db/schema.ts`**

```typescript
import { sqliteTable, integer, text, real } from 'drizzle-orm/sqlite-core';

export const users = sqliteTable('users', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  telegramId: text('telegram_id').notNull().unique(),
  displayName: text('display_name').notNull(),
  role: text('role', { enum: ['admin', 'member'] }).notNull().default('member'),
  firstSeenAt: text('first_seen_at').notNull(),
});

export const weights = sqliteTable('weights', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  grams: integer('grams').notNull().unique(),
});

export const brands = sqliteTable('brands', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  name: text('name').notNull().unique(),
});

export const flavors = sqliteTable('flavors', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  brandId: integer('brand_id').notNull().references(() => brands.id),
  name: text('name').notNull(),
});

export const vendors = sqliteTable('vendors', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  name: text('name').notNull(),
  archived: integer('archived', { mode: 'boolean' }).notNull().default(false),
});

export const vendorBrandPrices = sqliteTable('vendor_brand_prices', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  vendorId: integer('vendor_id').notNull().references(() => vendors.id),
  brandId: integer('brand_id').notNull().references(() => brands.id),
  pricePerKgEur: real('price_per_kg_eur').notNull(),
});

export const vendorFlavorAvailability = sqliteTable('vendor_flavor_availability', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  vendorId: integer('vendor_id').notNull().references(() => vendors.id),
  flavorId: integer('flavor_id').notNull().references(() => flavors.id),
  weightId: integer('weight_id').notNull().references(() => weights.id),
  available: integer('available', { mode: 'boolean' }).notNull(),
  updatedAt: text('updated_at').notNull(),
  sourceUploadId: integer('source_upload_id'),
});

export const availabilityUploads = sqliteTable('availability_uploads', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  vendorId: integer('vendor_id').notNull().references(() => vendors.id),
  brandId: integer('brand_id').notNull().references(() => brands.id),
  weightId: integer('weight_id').notNull().references(() => weights.id),
  imageRef: text('image_ref').notNull(),
  rawAiResponse: text('raw_ai_response').notNull(),
  createdAt: text('created_at').notNull(),
});

export const purchaseRounds = sqliteTable('purchase_rounds', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  vendorId: integer('vendor_id').notNull().references(() => vendors.id),
  status: text('status', { enum: ['open', 'closed'] }).notNull(),
  openedAt: text('opened_at').notNull(),
  closedAt: text('closed_at'),
  openedByUserId: integer('opened_by_user_id').notNull().references(() => users.id),
});

export const roundBrandPriceSnapshots = sqliteTable('round_brand_price_snapshots', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  roundId: integer('round_id').notNull().references(() => purchaseRounds.id),
  brandId: integer('brand_id').notNull().references(() => brands.id),
  pricePerKgEur: real('price_per_kg_eur').notNull(),
});

export const orderItems = sqliteTable('order_items', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  roundId: integer('round_id').notNull().references(() => purchaseRounds.id),
  userId: integer('user_id').notNull().references(() => users.id),
  brandId: integer('brand_id').notNull().references(() => brands.id),
  flavorId: integer('flavor_id').notNull().references(() => flavors.id),
  weightId: integer('weight_id').notNull().references(() => weights.id),
  quantity: integer('quantity').notNull(),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
});

export const roundPayments = sqliteTable('round_payments', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  roundId: integer('round_id').notNull().references(() => purchaseRounds.id),
  userId: integer('user_id').notNull().references(() => users.id),
  paid: integer('paid', { mode: 'boolean' }).notNull().default(false),
  markedAt: text('marked_at'),
  markedByUserId: integer('marked_by_user_id').references(() => users.id),
});

export const deliveryChecklistItems = sqliteTable('delivery_checklist_items', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  roundId: integer('round_id').notNull().references(() => purchaseRounds.id),
  brandId: integer('brand_id').notNull().references(() => brands.id),
  flavorId: integer('flavor_id').notNull().references(() => flavors.id),
  weightId: integer('weight_id').notNull().references(() => weights.id),
  expectedQty: integer('expected_qty').notNull(),
  receivedQty: integer('received_qty').notNull().default(0),
});
```

- [ ] **Step 3: Write `server/src/db/migrations/0000_init.sql`**

```sql
CREATE TABLE users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  telegram_id TEXT NOT NULL UNIQUE,
  display_name TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'member',
  first_seen_at TEXT NOT NULL
);

CREATE TABLE weights (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  grams INTEGER NOT NULL UNIQUE
);

CREATE TABLE brands (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE
);

CREATE TABLE flavors (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  brand_id INTEGER NOT NULL REFERENCES brands(id),
  name TEXT NOT NULL,
  UNIQUE(brand_id, name)
);

CREATE TABLE vendors (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  archived INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE vendor_brand_prices (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  vendor_id INTEGER NOT NULL REFERENCES vendors(id),
  brand_id INTEGER NOT NULL REFERENCES brands(id),
  price_per_kg_eur REAL NOT NULL,
  UNIQUE(vendor_id, brand_id)
);

CREATE TABLE vendor_flavor_availability (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  vendor_id INTEGER NOT NULL REFERENCES vendors(id),
  flavor_id INTEGER NOT NULL REFERENCES flavors(id),
  weight_id INTEGER NOT NULL REFERENCES weights(id),
  available INTEGER NOT NULL,
  updated_at TEXT NOT NULL,
  source_upload_id INTEGER,
  UNIQUE(vendor_id, flavor_id, weight_id)
);

CREATE TABLE availability_uploads (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  vendor_id INTEGER NOT NULL REFERENCES vendors(id),
  brand_id INTEGER NOT NULL REFERENCES brands(id),
  weight_id INTEGER NOT NULL REFERENCES weights(id),
  image_ref TEXT NOT NULL,
  raw_ai_response TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE purchase_rounds (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  vendor_id INTEGER NOT NULL REFERENCES vendors(id),
  status TEXT NOT NULL,
  opened_at TEXT NOT NULL,
  closed_at TEXT,
  opened_by_user_id INTEGER NOT NULL REFERENCES users(id)
);

CREATE TABLE round_brand_price_snapshots (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  round_id INTEGER NOT NULL REFERENCES purchase_rounds(id),
  brand_id INTEGER NOT NULL REFERENCES brands(id),
  price_per_kg_eur REAL NOT NULL,
  UNIQUE(round_id, brand_id)
);

CREATE TABLE order_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  round_id INTEGER NOT NULL REFERENCES purchase_rounds(id),
  user_id INTEGER NOT NULL REFERENCES users(id),
  brand_id INTEGER NOT NULL REFERENCES brands(id),
  flavor_id INTEGER NOT NULL REFERENCES flavors(id),
  weight_id INTEGER NOT NULL REFERENCES weights(id),
  quantity INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(round_id, user_id, brand_id, flavor_id, weight_id)
);

CREATE TABLE round_payments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  round_id INTEGER NOT NULL REFERENCES purchase_rounds(id),
  user_id INTEGER NOT NULL REFERENCES users(id),
  paid INTEGER NOT NULL DEFAULT 0,
  marked_at TEXT,
  marked_by_user_id INTEGER REFERENCES users(id),
  UNIQUE(round_id, user_id)
);

CREATE TABLE delivery_checklist_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  round_id INTEGER NOT NULL REFERENCES purchase_rounds(id),
  brand_id INTEGER NOT NULL REFERENCES brands(id),
  flavor_id INTEGER NOT NULL REFERENCES flavors(id),
  weight_id INTEGER NOT NULL REFERENCES weights(id),
  expected_qty INTEGER NOT NULL,
  received_qty INTEGER NOT NULL DEFAULT 0,
  UNIQUE(round_id, brand_id, flavor_id, weight_id)
);

INSERT INTO weights (grams) VALUES (100), (250);
```

- [ ] **Step 4: Write the failing test for the DB client**

```typescript
// server/src/db/client.test.ts
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
```

- [ ] **Step 5: Run test to verify it fails**

Run: `npm run test --workspace=@tobacconist/server`
Expected: FAIL — `./client` has no exported member `createTestDb` (module doesn't exist)

- [ ] **Step 6: Write `server/src/db/client.ts`**

```typescript
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
```

- [ ] **Step 7: Run test to verify it passes**

Run: `npm run test --workspace=@tobacconist/server`
Expected: PASS (2 tests)

- [ ] **Step 8: Commit**

```bash
git add server/
git commit -m "feat(server): add SQLite schema, migration, and db client"
```

---

### Task 3: Catalog & vendor domain

**Files:**
- Create: `server/src/domain/catalog.ts`
- Create: `server/src/domain/vendors.ts`
- Test: `server/src/domain/catalog.test.ts`
- Test: `server/src/domain/vendors.test.ts`

**Interfaces:**
- Consumes: `createTestDb`, `Db`, `schema.{weights,brands,flavors,vendors,vendorBrandPrices}` from `server/src/db/client.ts` (Task 2)
- Produces:
  - `packPriceEur(pricePerKgEur: number, grams: number): number`
  - `getWeights(db: Db): Promise<{ id: number; grams: number }[]>`
  - `createBrand(db: Db, name: string): Promise<{ id: number; name: string }>`
  - `listBrands(db: Db): Promise<{ id: number; name: string }[]>`
  - `findOrCreateFlavor(db: Db, brandId: number, name: string): Promise<{ id: number; brandId: number; name: string }>`
  - `listFlavorsByBrand(db: Db, brandId: number): Promise<{ id: number; brandId: number; name: string }[]>`
  - `createVendor(db: Db, name: string): Promise<{ id: number; name: string; archived: boolean }>`
  - `listVendors(db: Db, opts?: { includeArchived?: boolean }): Promise<{ id: number; name: string; archived: boolean }[]>`
  - `archiveVendor(db: Db, vendorId: number): Promise<void>`
  - `setVendorBrandPrice(db: Db, vendorId: number, brandId: number, pricePerKgEur: number): Promise<{ vendorId: number; brandId: number; pricePerKgEur: number }>`
  - `getVendorBrandPrices(db: Db, vendorId: number): Promise<{ vendorId: number; brandId: number; brandName: string; pricePerKgEur: number }[]>`

- [ ] **Step 1: Write the failing tests for `catalog.ts`**

```typescript
// server/src/domain/catalog.test.ts
import { describe, it, expect } from 'vitest';
import { createTestDb } from '../db/client';
import {
  packPriceEur,
  getWeights,
  createBrand,
  listBrands,
  findOrCreateFlavor,
  listFlavorsByBrand,
} from './catalog';

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
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm run test --workspace=@tobacconist/server -- catalog`
Expected: FAIL — `./catalog` module doesn't exist

- [ ] **Step 3: Write `server/src/domain/catalog.ts`**

```typescript
import { eq, and } from 'drizzle-orm';
import type { Db } from '../db/client';
import { weights, brands, flavors } from '../db/schema';

export function packPriceEur(pricePerKgEur: number, grams: number): number {
  return Math.round(pricePerKgEur * (grams / 1000) * 100) / 100;
}

export async function getWeights(db: Db) {
  return db.select().from(weights).all();
}

export async function createBrand(db: Db, name: string) {
  const [row] = await db.insert(brands).values({ name }).returning().all();
  return row;
}

export async function listBrands(db: Db) {
  return db.select().from(brands).all();
}

export async function findOrCreateFlavor(db: Db, brandId: number, name: string) {
  const existing = await db
    .select()
    .from(flavors)
    .where(and(eq(flavors.brandId, brandId), eq(flavors.name, name)))
    .get();
  if (existing) return existing;
  const [row] = await db.insert(flavors).values({ brandId, name }).returning().all();
  return row;
}

export async function listFlavorsByBrand(db: Db, brandId: number) {
  return db.select().from(flavors).where(eq(flavors.brandId, brandId)).all();
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm run test --workspace=@tobacconist/server -- catalog`
Expected: PASS (4 tests)

- [ ] **Step 5: Write the failing tests for `vendors.ts`**

```typescript
// server/src/domain/vendors.test.ts
import { describe, it, expect } from 'vitest';
import { createTestDb } from '../db/client';
import { createBrand } from './catalog';
import {
  createVendor,
  listVendors,
  archiveVendor,
  setVendorBrandPrice,
  getVendorBrandPrices,
} from './vendors';

describe('vendors domain', () => {
  it('createVendor + listVendors excludes archived by default', async () => {
    const db = createTestDb();
    const v = await createVendor(db, 'Vasya');
    await archiveVendor(db, v.id);
    const active = await listVendors(db);
    const all = await listVendors(db, { includeArchived: true });
    expect(active).toHaveLength(0);
    expect(all).toHaveLength(1);
  });

  it('setVendorBrandPrice upserts on repeat calls', async () => {
    const db = createTestDb();
    const v = await createVendor(db, 'Vasya');
    const brand = await createBrand(db, 'DarkSide');
    await setVendorBrandPrice(db, v.id, brand.id, 18);
    await setVendorBrandPrice(db, v.id, brand.id, 20);
    const prices = await getVendorBrandPrices(db, v.id);
    expect(prices).toEqual([
      { vendorId: v.id, brandId: brand.id, brandName: 'DarkSide', pricePerKgEur: 20 },
    ]);
  });
});
```

- [ ] **Step 6: Run tests to verify they fail**

Run: `npm run test --workspace=@tobacconist/server -- vendors`
Expected: FAIL — `./vendors` module doesn't exist

- [ ] **Step 7: Write `server/src/domain/vendors.ts`**

```typescript
import { eq } from 'drizzle-orm';
import type { Db } from '../db/client';
import { vendors, vendorBrandPrices, brands } from '../db/schema';

export async function createVendor(db: Db, name: string) {
  const [row] = await db.insert(vendors).values({ name }).returning().all();
  return row;
}

export async function listVendors(db: Db, opts?: { includeArchived?: boolean }) {
  const rows = await db.select().from(vendors).all();
  return opts?.includeArchived ? rows : rows.filter((v) => !v.archived);
}

export async function archiveVendor(db: Db, vendorId: number) {
  await db.update(vendors).set({ archived: true }).where(eq(vendors.id, vendorId)).run();
}

export async function setVendorBrandPrice(
  db: Db,
  vendorId: number,
  brandId: number,
  pricePerKgEur: number
) {
  const existing = await db
    .select()
    .from(vendorBrandPrices)
    .where(
      eq(vendorBrandPrices.vendorId, vendorId)
    )
    .all();
  const row = existing.find((r) => r.brandId === brandId);
  if (row) {
    await db
      .update(vendorBrandPrices)
      .set({ pricePerKgEur })
      .where(eq(vendorBrandPrices.id, row.id))
      .run();
  } else {
    await db.insert(vendorBrandPrices).values({ vendorId, brandId, pricePerKgEur }).run();
  }
  return { vendorId, brandId, pricePerKgEur };
}

export async function getVendorBrandPrices(db: Db, vendorId: number) {
  const rows = await db
    .select({
      vendorId: vendorBrandPrices.vendorId,
      brandId: vendorBrandPrices.brandId,
      brandName: brands.name,
      pricePerKgEur: vendorBrandPrices.pricePerKgEur,
    })
    .from(vendorBrandPrices)
    .innerJoin(brands, eq(brands.id, vendorBrandPrices.brandId))
    .where(eq(vendorBrandPrices.vendorId, vendorId))
    .all();
  return rows;
}
```

- [ ] **Step 8: Run tests to verify they pass**

Run: `npm run test --workspace=@tobacconist/server -- vendors`
Expected: PASS (2 tests)

- [ ] **Step 9: Commit**

```bash
git add server/src/domain/catalog.ts server/src/domain/catalog.test.ts server/src/domain/vendors.ts server/src/domain/vendors.test.ts
git commit -m "feat(server): add catalog and vendor domain logic"
```

---

### Task 4: Availability domain (replace-on-upload)

**Files:**
- Create: `server/src/domain/availability.ts`
- Test: `server/src/domain/availability.test.ts`

**Interfaces:**
- Consumes: `Db`, `createTestDb` (Task 2); `createBrand`, `createVendor`... actually `createVendor` from `vendors.ts`, `createBrand`/`findOrCreateFlavor` from `catalog.ts` (Task 3)
- Produces:
  - `replaceAvailability(db: Db, params: { vendorId: number; brandId: number; weightId: number; entries: { name: string; available: boolean }[] }): Promise<{ flavorId: number; flavorName: string; available: boolean }[]>`
  - `isAvailable(db: Db, vendorId: number, flavorId: number, weightId: number): Promise<boolean>`
  - `listVendorAssortment(db: Db, vendorId: number, opts?: { onlyAvailable?: boolean }): Promise<{ brandId: number; brandName: string; flavorId: number; flavorName: string; weightId: number; grams: number; available: boolean }[]>`

- [ ] **Step 1: Write the failing tests**

```typescript
// server/src/domain/availability.test.ts
import { describe, it, expect } from 'vitest';
import { createTestDb } from '../db/client';
import { createVendor } from './vendors';
import { createBrand, getWeights } from './catalog';
import { replaceAvailability, isAvailable, listVendorAssortment } from './availability';

async function setup() {
  const db = createTestDb();
  const vendor = await createVendor(db, 'Vasya');
  const brand = await createBrand(db, 'DarkSide');
  const w = await getWeights(db);
  const w250 = w.find((x) => x.grams === 250)!;
  const w100 = w.find((x) => x.grams === 100)!;
  return { db, vendor, brand, w250, w100 };
}

describe('availability domain', () => {
  it('replaceAvailability creates flavors and marks them available', async () => {
    const { db, vendor, brand, w250 } = await setup();
    const result = await replaceAvailability(db, {
      vendorId: vendor.id,
      brandId: brand.id,
      weightId: w250.id,
      entries: [
        { name: 'CyberKiwi', available: true },
        { name: 'Mango', available: false },
      ],
    });
    expect(result.find((r) => r.flavorName === 'CyberKiwi')?.available).toBe(true);
    expect(result.find((r) => r.flavorName === 'Mango')?.available).toBe(false);
  });

  it('a second upload for the same (brand, weight) fully replaces prior availability', async () => {
    const { db, vendor, brand, w250 } = await setup();
    await replaceAvailability(db, {
      vendorId: vendor.id,
      brandId: brand.id,
      weightId: w250.id,
      entries: [{ name: 'CyberKiwi', available: true }],
    });
    await replaceAvailability(db, {
      vendorId: vendor.id,
      brandId: brand.id,
      weightId: w250.id,
      entries: [{ name: 'Mango', available: true }],
    });
    const cyberKiwiFlavorId = (
      await listVendorAssortment(db, vendor.id)
    ).find((r) => r.flavorName === 'CyberKiwi')!.flavorId;
    expect(await isAvailable(db, vendor.id, cyberKiwiFlavorId, w250.id)).toBe(false);
  });

  it('availability is independent per weight', async () => {
    const { db, vendor, brand, w250, w100 } = await setup();
    await replaceAvailability(db, {
      vendorId: vendor.id,
      brandId: brand.id,
      weightId: w250.id,
      entries: [{ name: 'CyberKiwi', available: true }],
    });
    const assortment = await listVendorAssortment(db, vendor.id);
    const cyberKiwiFlavorId = assortment.find((r) => r.flavorName === 'CyberKiwi')!.flavorId;
    expect(await isAvailable(db, vendor.id, cyberKiwiFlavorId, w100.id)).toBe(false);
  });

  it('listVendorAssortment onlyAvailable filters out unavailable rows', async () => {
    const { db, vendor, brand, w250 } = await setup();
    await replaceAvailability(db, {
      vendorId: vendor.id,
      brandId: brand.id,
      weightId: w250.id,
      entries: [
        { name: 'CyberKiwi', available: true },
        { name: 'Mango', available: false },
      ],
    });
    const rows = await listVendorAssortment(db, vendor.id, { onlyAvailable: true });
    expect(rows.map((r) => r.flavorName)).toEqual(['CyberKiwi']);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm run test --workspace=@tobacconist/server -- availability`
Expected: FAIL — `./availability` module doesn't exist

- [ ] **Step 3: Write `server/src/domain/availability.ts`**

```typescript
import { eq, and } from 'drizzle-orm';
import type { Db } from '../db/client';
import { vendorFlavorAvailability, flavors, brands, weights } from '../db/schema';
import { findOrCreateFlavor } from './catalog';

export async function replaceAvailability(
  db: Db,
  params: {
    vendorId: number;
    brandId: number;
    weightId: number;
    entries: { name: string; available: boolean }[];
  }
) {
  const { vendorId, brandId, weightId, entries } = params;
  const now = new Date().toISOString();

  const existingForTriple = await db
    .select()
    .from(vendorFlavorAvailability)
    .innerJoin(flavors, eq(flavors.id, vendorFlavorAvailability.flavorId))
    .where(
      and(
        eq(vendorFlavorAvailability.vendorId, vendorId),
        eq(vendorFlavorAvailability.weightId, weightId),
        eq(flavors.brandId, brandId)
      )
    )
    .all();

  const seenFlavorIds = new Set<number>();
  const result: { flavorId: number; flavorName: string; available: boolean }[] = [];

  for (const entry of entries) {
    const flavor = await findOrCreateFlavor(db, brandId, entry.name);
    seenFlavorIds.add(flavor.id);
    const existingRow = existingForTriple.find(
      (r) => r.vendor_flavor_availability.flavorId === flavor.id
    );
    if (existingRow) {
      await db
        .update(vendorFlavorAvailability)
        .set({ available: entry.available, updatedAt: now })
        .where(eq(vendorFlavorAvailability.id, existingRow.vendor_flavor_availability.id))
        .run();
    } else {
      await db
        .insert(vendorFlavorAvailability)
        .values({ vendorId, flavorId: flavor.id, weightId, available: entry.available, updatedAt: now })
        .run();
    }
    result.push({ flavorId: flavor.id, flavorName: entry.name, available: entry.available });
  }

  for (const row of existingForTriple) {
    const fid = row.vendor_flavor_availability.flavorId;
    if (!seenFlavorIds.has(fid)) {
      await db
        .update(vendorFlavorAvailability)
        .set({ available: false, updatedAt: now })
        .where(eq(vendorFlavorAvailability.id, row.vendor_flavor_availability.id))
        .run();
      result.push({ flavorId: fid, flavorName: row.flavors.name, available: false });
    }
  }

  return result;
}

export async function isAvailable(db: Db, vendorId: number, flavorId: number, weightId: number) {
  const row = await db
    .select()
    .from(vendorFlavorAvailability)
    .where(
      and(
        eq(vendorFlavorAvailability.vendorId, vendorId),
        eq(vendorFlavorAvailability.flavorId, flavorId),
        eq(vendorFlavorAvailability.weightId, weightId)
      )
    )
    .get();
  return row?.available ?? false;
}

export async function listVendorAssortment(
  db: Db,
  vendorId: number,
  opts?: { onlyAvailable?: boolean }
) {
  const rows = await db
    .select({
      brandId: brands.id,
      brandName: brands.name,
      flavorId: flavors.id,
      flavorName: flavors.name,
      weightId: weights.id,
      grams: weights.grams,
      available: vendorFlavorAvailability.available,
    })
    .from(vendorFlavorAvailability)
    .innerJoin(flavors, eq(flavors.id, vendorFlavorAvailability.flavorId))
    .innerJoin(brands, eq(brands.id, flavors.brandId))
    .innerJoin(weights, eq(weights.id, vendorFlavorAvailability.weightId))
    .where(eq(vendorFlavorAvailability.vendorId, vendorId))
    .all();
  return opts?.onlyAvailable ? rows.filter((r) => r.available) : rows;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm run test --workspace=@tobacconist/server -- availability`
Expected: PASS (4 tests)

- [ ] **Step 5: Commit**

```bash
git add server/src/domain/availability.ts server/src/domain/availability.test.ts
git commit -m "feat(server): add availability domain with replace-on-upload semantics"
```

---

### Task 5: Gemini vision client & availability image parser

**Files:**
- Create: `server/src/gemini/client.ts`
- Create: `server/src/gemini/availabilityParser.ts`
- Test: `server/src/gemini/availabilityParser.test.ts`

**Interfaces:**
- Consumes: nothing from earlier tasks (pure, injectable)
- Produces:
  - `interface GeminiClient { generateFromImage(params: { imageBase64: string; mimeType: string; prompt: string }): Promise<string> }`
  - `createGeminiClient(apiKey: string): GeminiClient`
  - `parseAvailabilityImage(client: GeminiClient, params: { imageBase64: string; mimeType: string }): Promise<{ name: string; available: boolean }[]>`
  - Used by the availability-upload API route (Task 16) which injects the real client and calls `replaceAvailability` (Task 4) with the result.

- [ ] **Step 1: Write `server/src/gemini/client.ts`**

```typescript
import { GoogleGenerativeAI } from '@google/generative-ai';

export interface GeminiClient {
  generateFromImage(params: { imageBase64: string; mimeType: string; prompt: string }): Promise<string>;
}

export function createGeminiClient(apiKey: string): GeminiClient {
  const genAI = new GoogleGenerativeAI(apiKey);
  const model = genAI.getGenerativeModel({ model: 'gemini-1.5-flash' });

  return {
    async generateFromImage({ imageBase64, mimeType, prompt }) {
      const result = await model.generateContent([
        { inlineData: { data: imageBase64, mimeType } },
        { text: prompt },
      ]);
      return result.response.text();
    },
  };
}
```

- [ ] **Step 2: Write the failing tests for the parser**

```typescript
// server/src/gemini/availabilityParser.test.ts
import { describe, it, expect } from 'vitest';
import type { GeminiClient } from './client';
import { parseAvailabilityImage } from './availabilityParser';

function mockClient(responseText: string): GeminiClient {
  return { generateFromImage: async () => responseText };
}

describe('parseAvailabilityImage', () => {
  it('parses a clean JSON array response', async () => {
    const client = mockClient(
      JSON.stringify([
        { name: 'CyberKiwi', available: true },
        { name: 'Mango', available: false },
      ])
    );
    const result = await parseAvailabilityImage(client, {
      imageBase64: 'x',
      mimeType: 'image/jpeg',
    });
    expect(result).toEqual([
      { name: 'CyberKiwi', available: true },
      { name: 'Mango', available: false },
    ]);
  });

  it('strips a markdown code fence around the JSON', async () => {
    const client = mockClient('```json\n[{"name":"Mango","available":true}]\n```');
    const result = await parseAvailabilityImage(client, {
      imageBase64: 'x',
      mimeType: 'image/jpeg',
    });
    expect(result).toEqual([{ name: 'Mango', available: true }]);
  });

  it('throws a descriptive error on unparseable response', async () => {
    const client = mockClient('sorry, I cannot help with that');
    await expect(
      parseAvailabilityImage(client, { imageBase64: 'x', mimeType: 'image/jpeg' })
    ).rejects.toThrow(/failed to parse Gemini availability response/i);
  });

  it('throws when entries are missing required fields', async () => {
    const client = mockClient(JSON.stringify([{ name: 'Mango' }]));
    await expect(
      parseAvailabilityImage(client, { imageBase64: 'x', mimeType: 'image/jpeg' })
    ).rejects.toThrow(/failed to parse Gemini availability response/i);
  });
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `npm run test --workspace=@tobacconist/server -- availabilityParser`
Expected: FAIL — `./availabilityParser` module doesn't exist

- [ ] **Step 4: Write `server/src/gemini/availabilityParser.ts`**

```typescript
import type { GeminiClient } from './client';

const PROMPT = `You are reading a photo of a tobacco vendor's flavor availability list for one brand and one pack weight. List every flavor name you can read. A flavor is UNAVAILABLE if its text is struck through (a line drawn through it) in the photo; otherwise it is AVAILABLE. Respond with ONLY a JSON array, no prose, no markdown fences, in this exact shape: [{"name": string, "available": boolean}, ...]`;

function extractJson(text: string): string {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  return (fenced ? fenced[1] : text).trim();
}

export async function parseAvailabilityImage(
  client: GeminiClient,
  params: { imageBase64: string; mimeType: string }
): Promise<{ name: string; available: boolean }[]> {
  const raw = await client.generateFromImage({
    imageBase64: params.imageBase64,
    mimeType: params.mimeType,
    prompt: PROMPT,
  });

  let parsed: unknown;
  try {
    parsed = JSON.parse(extractJson(raw));
  } catch {
    throw new Error('failed to parse Gemini availability response: not valid JSON');
  }

  if (!Array.isArray(parsed)) {
    throw new Error('failed to parse Gemini availability response: expected a JSON array');
  }

  const entries = parsed.map((item) => {
    if (
      typeof item !== 'object' ||
      item === null ||
      typeof (item as any).name !== 'string' ||
      typeof (item as any).available !== 'boolean'
    ) {
      throw new Error(
        'failed to parse Gemini availability response: entry missing name/available fields'
      );
    }
    return { name: (item as any).name as string, available: (item as any).available as boolean };
  });

  return entries;
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npm run test --workspace=@tobacconist/server -- availabilityParser`
Expected: PASS (4 tests)

- [ ] **Step 6: Commit**

```bash
git add server/src/gemini/
git commit -m "feat(server): add Gemini vision client and availability image parser"
```

---

### Task 6: Purchase round domain (lifecycle + price snapshot)

**Files:**
- Create: `server/src/domain/rounds.ts`
- Test: `server/src/domain/rounds.test.ts`

**Note:** `closeRound` only flips round status — it does NOT regenerate the delivery checklist itself. The checklist domain (Task 9) and the close-round API route (Task 17) are responsible for calling `generateOrUpdateChecklist` right after `closeRound` succeeds, keeping these two domain modules independently testable.

**Interfaces:**
- Consumes: `Db`, `createTestDb` (Task 2); `createVendor` (Task 3); `setVendorBrandPrice` (Task 3)
- Produces:
  - `openRound(db: Db, vendorId: number, openedByUserId: number): Promise<{ id: number; vendorId: number; status: 'open' | 'closed'; openedAt: string; closedAt: string | null; openedByUserId: number }>` — throws `Error('a round is already open')` if one exists
  - `closeRound(db: Db, roundId: number): Promise<void>` — throws if round missing or already closed
  - `reopenRound(db: Db, roundId: number): Promise<void>` — throws if round missing, not closed, or another round is currently open
  - `getActiveRound(db: Db): Promise<Round | null>`
  - `getRound(db: Db, roundId: number): Promise<Round | null>`
  - `getRoundPriceSnapshot(db: Db, roundId: number, brandId: number): Promise<number | null>`
  - Consumed by: Task 7 (orders — validates round is open), Task 17 (rounds API route)

- [ ] **Step 1: Write the failing tests**

```typescript
// server/src/domain/rounds.test.ts
import { describe, it, expect } from 'vitest';
import { createTestDb } from '../db/client';
import { createVendor, setVendorBrandPrice } from './vendors';
import { createBrand } from './catalog';
import { users } from '../db/schema';
import {
  openRound,
  closeRound,
  reopenRound,
  getActiveRound,
  getRoundPriceSnapshot,
} from './rounds';

async function setup() {
  const db = createTestDb();
  const [admin] = await db
    .insert(users)
    .values({ telegramId: 't1', displayName: 'Admin', role: 'admin', firstSeenAt: new Date().toISOString() })
    .returning()
    .all();
  const vendor = await createVendor(db, 'Vasya');
  const brand = await createBrand(db, 'DarkSide');
  await setVendorBrandPrice(db, vendor.id, brand.id, 18);
  return { db, admin, vendor, brand };
}

describe('rounds domain', () => {
  it('openRound creates an open round and snapshots current prices', async () => {
    const { db, admin, vendor, brand } = await setup();
    const round = await openRound(db, vendor.id, admin.id);
    expect(round.status).toBe('open');
    expect(await getRoundPriceSnapshot(db, round.id, brand.id)).toBe(18);
  });

  it('rejects opening a second round while one is open', async () => {
    const { db, admin, vendor } = await setup();
    await openRound(db, vendor.id, admin.id);
    await expect(openRound(db, vendor.id, admin.id)).rejects.toThrow(/already open/i);
  });

  it('price snapshot is frozen even if the live price changes later', async () => {
    const { db, admin, vendor, brand } = await setup();
    const round = await openRound(db, vendor.id, admin.id);
    await setVendorBrandPrice(db, vendor.id, brand.id, 25);
    expect(await getRoundPriceSnapshot(db, round.id, brand.id)).toBe(18);
  });

  it('closeRound flips status and clears active round', async () => {
    const { db, admin, vendor } = await setup();
    const round = await openRound(db, vendor.id, admin.id);
    await closeRound(db, round.id);
    expect(await getActiveRound(db)).toBeNull();
  });

  it('closing an already-closed round throws', async () => {
    const { db, admin, vendor } = await setup();
    const round = await openRound(db, vendor.id, admin.id);
    await closeRound(db, round.id);
    await expect(closeRound(db, round.id)).rejects.toThrow(/already closed/i);
  });

  it('reopenRound restores open status', async () => {
    const { db, admin, vendor } = await setup();
    const round = await openRound(db, vendor.id, admin.id);
    await closeRound(db, round.id);
    await reopenRound(db, round.id);
    const active = await getActiveRound(db);
    expect(active?.id).toBe(round.id);
  });

  it('reopenRound rejects when a different round is already open', async () => {
    const { db, admin, vendor } = await setup();
    const roundA = await openRound(db, vendor.id, admin.id);
    await closeRound(db, roundA.id);
    await openRound(db, vendor.id, admin.id); // roundB now open
    await expect(reopenRound(db, roundA.id)).rejects.toThrow(/already open/i);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm run test --workspace=@tobacconist/server -- rounds`
Expected: FAIL — `./rounds` module doesn't exist

- [ ] **Step 3: Write `server/src/domain/rounds.ts`**

```typescript
import { eq } from 'drizzle-orm';
import type { Db } from '../db/client';
import { purchaseRounds, roundBrandPriceSnapshots, vendorBrandPrices } from '../db/schema';

export type Round = typeof purchaseRounds.$inferSelect;

export async function getActiveRound(db: Db): Promise<Round | null> {
  const row = await db.select().from(purchaseRounds).where(eq(purchaseRounds.status, 'open')).get();
  return row ?? null;
}

export async function getRound(db: Db, roundId: number): Promise<Round | null> {
  const row = await db.select().from(purchaseRounds).where(eq(purchaseRounds.id, roundId)).get();
  return row ?? null;
}

export async function openRound(db: Db, vendorId: number, openedByUserId: number) {
  const active = await getActiveRound(db);
  if (active) throw new Error('a round is already open');

  const now = new Date().toISOString();
  const [round] = await db
    .insert(purchaseRounds)
    .values({ vendorId, status: 'open', openedAt: now, openedByUserId })
    .returning()
    .all();

  const prices = await db
    .select()
    .from(vendorBrandPrices)
    .where(eq(vendorBrandPrices.vendorId, vendorId))
    .all();

  for (const p of prices) {
    await db
      .insert(roundBrandPriceSnapshots)
      .values({ roundId: round.id, brandId: p.brandId, pricePerKgEur: p.pricePerKgEur })
      .run();
  }

  return round;
}

export async function closeRound(db: Db, roundId: number) {
  const round = await getRound(db, roundId);
  if (!round) throw new Error('round not found');
  if (round.status === 'closed') throw new Error('round is already closed');
  await db
    .update(purchaseRounds)
    .set({ status: 'closed', closedAt: new Date().toISOString() })
    .where(eq(purchaseRounds.id, roundId))
    .run();
}

export async function reopenRound(db: Db, roundId: number) {
  const round = await getRound(db, roundId);
  if (!round) throw new Error('round not found');
  if (round.status !== 'closed') throw new Error('round is not closed');
  const active = await getActiveRound(db);
  if (active) throw new Error('a different round is already open');
  await db
    .update(purchaseRounds)
    .set({ status: 'open', closedAt: null })
    .where(eq(purchaseRounds.id, roundId))
    .run();
}

export async function getRoundPriceSnapshot(db: Db, roundId: number, brandId: number) {
  const row = await db
    .select()
    .from(roundBrandPriceSnapshots)
    .where(eq(roundBrandPriceSnapshots.roundId, roundId))
    .all();
  return row.find((r) => r.brandId === brandId)?.pricePerKgEur ?? null;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm run test --workspace=@tobacconist/server -- rounds`
Expected: PASS (7 tests)

- [ ] **Step 5: Commit**

```bash
git add server/src/domain/rounds.ts server/src/domain/rounds.test.ts
git commit -m "feat(server): add purchase round lifecycle domain"
```

---

### Task 7: Order domain

**Files:**
- Create: `server/src/domain/orders.ts`
- Test: `server/src/domain/orders.test.ts`

**Interfaces:**
- Consumes: `Db`, `createTestDb` (Task 2); `createVendor`, `setVendorBrandPrice` (Task 3); `createBrand` (Task 3); `replaceAvailability` (Task 4); `openRound`, `closeRound`, `getRound` (Task 6); `users` table (Task 2)
- Produces:
  - `upsertOrderItem(db: Db, params: { roundId: number; userId: number; brandId: number; flavorId: number; weightId: number; quantity: number }): Promise<{ id: number; roundId: number; userId: number; brandId: number; flavorId: number; weightId: number; quantity: number } | null>` — throws if round isn't open or the (flavor, weight) isn't available for the round's vendor; returns `null` and deletes the row when `quantity` is 0
  - `listUserOrderItems(db: Db, roundId: number, userId: number): Promise<OrderItemRow[]>`
  - `listRoundOrderItems(db: Db, roundId: number): Promise<OrderItemRow[]>`
  - Consumed by: Task 8 (summary), Task 16 (orders API route)

- [ ] **Step 1: Write the failing tests**

```typescript
// server/src/domain/orders.test.ts
import { describe, it, expect } from 'vitest';
import { createTestDb } from '../db/client';
import { createVendor, setVendorBrandPrice } from './vendors';
import { createBrand, getWeights } from './catalog';
import { replaceAvailability } from './availability';
import { openRound, closeRound } from './rounds';
import { users } from '../db/schema';
import { upsertOrderItem, listUserOrderItems, listRoundOrderItems } from './orders';

async function setup() {
  const db = createTestDb();
  const [admin] = await db
    .insert(users)
    .values({ telegramId: 'a1', displayName: 'Admin', role: 'admin', firstSeenAt: new Date().toISOString() })
    .returning()
    .all();
  const [member] = await db
    .insert(users)
    .values({ telegramId: 'm1', displayName: 'Friend', role: 'member', firstSeenAt: new Date().toISOString() })
    .returning()
    .all();
  const vendor = await createVendor(db, 'Vasya');
  const brand = await createBrand(db, 'DarkSide');
  await setVendorBrandPrice(db, vendor.id, brand.id, 18);
  const w250 = (await getWeights(db)).find((w) => w.grams === 250)!;
  const [{ flavorId }] = await replaceAvailability(db, {
    vendorId: vendor.id,
    brandId: brand.id,
    weightId: w250.id,
    entries: [{ name: 'CyberKiwi', available: true }],
  });
  const round = await openRound(db, vendor.id, admin.id);
  return { db, admin, member, vendor, brand, w250, flavorId, round };
}

describe('orders domain', () => {
  it('creates an order item for an available flavor in an open round', async () => {
    const { db, member, brand, w250, flavorId, round } = await setup();
    const item = await upsertOrderItem(db, {
      roundId: round.id,
      userId: member.id,
      brandId: brand.id,
      flavorId,
      weightId: w250.id,
      quantity: 2,
    });
    expect(item?.quantity).toBe(2);
  });

  it('rejects orders for an unavailable (flavor, weight) pair', async () => {
    const { db, member, brand, w250, flavorId, round } = await setup();
    const w100 = (await getWeights(db)).find((w) => w.grams === 100)!;
    await expect(
      upsertOrderItem(db, {
        roundId: round.id,
        userId: member.id,
        brandId: brand.id,
        flavorId,
        weightId: w100.id,
        quantity: 1,
      })
    ).rejects.toThrow(/not available/i);
  });

  it('rejects orders against a closed round', async () => {
    const { db, member, brand, w250, flavorId, round } = await setup();
    await closeRound(db, round.id);
    await expect(
      upsertOrderItem(db, {
        roundId: round.id,
        userId: member.id,
        brandId: brand.id,
        flavorId,
        weightId: w250.id,
        quantity: 1,
      })
    ).rejects.toThrow(/not open/i);
  });

  it('repeat calls update quantity instead of duplicating rows', async () => {
    const { db, member, brand, w250, flavorId, round } = await setup();
    await upsertOrderItem(db, { roundId: round.id, userId: member.id, brandId: brand.id, flavorId, weightId: w250.id, quantity: 2 });
    await upsertOrderItem(db, { roundId: round.id, userId: member.id, brandId: brand.id, flavorId, weightId: w250.id, quantity: 5 });
    const items = await listUserOrderItems(db, round.id, member.id);
    expect(items).toHaveLength(1);
    expect(items[0].quantity).toBe(5);
  });

  it('quantity 0 deletes the row', async () => {
    const { db, member, brand, w250, flavorId, round } = await setup();
    await upsertOrderItem(db, { roundId: round.id, userId: member.id, brandId: brand.id, flavorId, weightId: w250.id, quantity: 2 });
    const result = await upsertOrderItem(db, { roundId: round.id, userId: member.id, brandId: brand.id, flavorId, weightId: w250.id, quantity: 0 });
    expect(result).toBeNull();
    expect(await listUserOrderItems(db, round.id, member.id)).toHaveLength(0);
  });

  it('listRoundOrderItems returns items across all users', async () => {
    const { db, admin, member, brand, w250, flavorId, round } = await setup();
    await upsertOrderItem(db, { roundId: round.id, userId: member.id, brandId: brand.id, flavorId, weightId: w250.id, quantity: 2 });
    await upsertOrderItem(db, { roundId: round.id, userId: admin.id, brandId: brand.id, flavorId, weightId: w250.id, quantity: 1 });
    const items = await listRoundOrderItems(db, round.id);
    expect(items).toHaveLength(2);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm run test --workspace=@tobacconist/server -- orders`
Expected: FAIL — `./orders` module doesn't exist

- [ ] **Step 3: Write `server/src/domain/orders.ts`**

```typescript
import { eq, and } from 'drizzle-orm';
import type { Db } from '../db/client';
import { orderItems } from '../db/schema';
import { getRound } from './rounds';
import { isAvailable } from './availability';

export type OrderItemRow = typeof orderItems.$inferSelect;

export async function upsertOrderItem(
  db: Db,
  params: {
    roundId: number;
    userId: number;
    brandId: number;
    flavorId: number;
    weightId: number;
    quantity: number;
  }
): Promise<OrderItemRow | null> {
  const { roundId, userId, brandId, flavorId, weightId, quantity } = params;

  const round = await getRound(db, roundId);
  if (!round) throw new Error('round not found');
  if (round.status !== 'open') throw new Error('round is not open');

  const available = await isAvailable(db, round.vendorId, flavorId, weightId);
  if (!available) throw new Error('this flavor/weight is not available for the round vendor');

  const existing = await db
    .select()
    .from(orderItems)
    .where(
      and(
        eq(orderItems.roundId, roundId),
        eq(orderItems.userId, userId),
        eq(orderItems.brandId, brandId),
        eq(orderItems.flavorId, flavorId),
        eq(orderItems.weightId, weightId)
      )
    )
    .get();

  if (quantity <= 0) {
    if (existing) await db.delete(orderItems).where(eq(orderItems.id, existing.id)).run();
    return null;
  }

  const now = new Date().toISOString();
  if (existing) {
    const [row] = await db
      .update(orderItems)
      .set({ quantity, updatedAt: now })
      .where(eq(orderItems.id, existing.id))
      .returning()
      .all();
    return row;
  }

  const [row] = await db
    .insert(orderItems)
    .values({ roundId, userId, brandId, flavorId, weightId, quantity, createdAt: now, updatedAt: now })
    .returning()
    .all();
  return row;
}

export async function listUserOrderItems(db: Db, roundId: number, userId: number) {
  return db
    .select()
    .from(orderItems)
    .where(and(eq(orderItems.roundId, roundId), eq(orderItems.userId, userId)))
    .all();
}

export async function listRoundOrderItems(db: Db, roundId: number) {
  return db.select().from(orderItems).where(eq(orderItems.roundId, roundId)).all();
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm run test --workspace=@tobacconist/server -- orders`
Expected: PASS (6 tests)

- [ ] **Step 5: Commit**

```bash
git add server/src/domain/orders.ts server/src/domain/orders.test.ts
git commit -m "feat(server): add order item domain with availability and round-open validation"
```

---

### Task 8: Summary domain (per-user & aggregate)

**Files:**
- Create: `server/src/domain/summary.ts`
- Test: `server/src/domain/summary.test.ts`

**Note:** Payment status (`paid`) is intentionally NOT part of this domain's output — it's owned by the payments domain (Task 10) and merged in by the API route layer (Task 21) when building the final `UserSummaryDto`.

**Interfaces:**
- Consumes: `Db`, `createTestDb` (Task 2); `createVendor`, `setVendorBrandPrice` (Task 3); `createBrand` (Task 3); `replaceAvailability` (Task 4); `openRound` (Task 6); `upsertOrderItem` (Task 7)
- Produces:
  - `computeUserSummary(db: Db, roundId: number, userId: number): Promise<{ items: AggregateLine[]; totalKg: number; totalEur: number; hasUnavailableItems: boolean }>`
  - `computeAggregateSummary(db: Db, roundId: number): Promise<{ lines: AggregateLine[]; totalKg: number; totalEur: number }>`
  - where `AggregateLine = { brandId: number; brandName: string; flavorId: number; flavorName: string; weightId: number; grams: number; quantity: number; totalEur: number }`
  - Consumed by: Task 11 (snapshot text/table builders), Task 19/21 (API routes)

- [ ] **Step 1: Write the failing tests**

```typescript
// server/src/domain/summary.test.ts
import { describe, it, expect } from 'vitest';
import { createTestDb } from '../db/client';
import { createVendor, setVendorBrandPrice } from './vendors';
import { createBrand, getWeights } from './catalog';
import { replaceAvailability } from './availability';
import { openRound } from './rounds';
import { upsertOrderItem } from './orders';
import { users } from '../db/schema';
import { computeUserSummary, computeAggregateSummary } from './summary';

async function setup() {
  const db = createTestDb();
  const [admin] = await db.insert(users).values({ telegramId: 'a1', displayName: 'Admin', role: 'admin', firstSeenAt: new Date().toISOString() }).returning().all();
  const [friend] = await db.insert(users).values({ telegramId: 'f1', displayName: 'Friend', role: 'member', firstSeenAt: new Date().toISOString() }).returning().all();
  const vendor = await createVendor(db, 'Vasya');
  const brand = await createBrand(db, 'DarkSide');
  await setVendorBrandPrice(db, vendor.id, brand.id, 20); // 20 EUR/kg
  const w250 = (await getWeights(db)).find((w) => w.grams === 250)!;
  const [{ flavorId }] = await replaceAvailability(db, {
    vendorId: vendor.id,
    brandId: brand.id,
    weightId: w250.id,
    entries: [{ name: 'CyberKiwi', available: true }],
  });
  const round = await openRound(db, vendor.id, admin.id);
  return { db, admin, friend, vendor, brand, w250, flavorId, round };
}

describe('summary domain', () => {
  it('computeUserSummary totals kg and eur at the pack price (20 EUR/kg * 250g = 5 EUR/pack)', async () => {
    const { db, friend, brand, w250, flavorId, round } = await setup();
    await upsertOrderItem(db, { roundId: round.id, userId: friend.id, brandId: brand.id, flavorId, weightId: w250.id, quantity: 3 });
    const summary = await computeUserSummary(db, round.id, friend.id);
    expect(summary.totalEur).toBeCloseTo(15.0);
    expect(summary.totalKg).toBeCloseTo(0.75);
    expect(summary.hasUnavailableItems).toBe(false);
  });

  it('flags hasUnavailableItems when a re-upload later removes the flavor', async () => {
    const { db, brand, vendor, friend, w250, flavorId, round } = await setup();
    await upsertOrderItem(db, { roundId: round.id, userId: friend.id, brandId: brand.id, flavorId, weightId: w250.id, quantity: 1 });
    await replaceAvailability(db, { vendorId: vendor.id, brandId: brand.id, weightId: w250.id, entries: [] });
    const summary = await computeUserSummary(db, round.id, friend.id);
    expect(summary.hasUnavailableItems).toBe(true);
    expect(summary.items).toHaveLength(1); // still present, just flagged
  });

  it('computeAggregateSummary sums quantities across users for the same line', async () => {
    const { db, admin, friend, brand, w250, flavorId, round } = await setup();
    await upsertOrderItem(db, { roundId: round.id, userId: friend.id, brandId: brand.id, flavorId, weightId: w250.id, quantity: 3 });
    await upsertOrderItem(db, { roundId: round.id, userId: admin.id, brandId: brand.id, flavorId, weightId: w250.id, quantity: 2 });
    const summary = await computeAggregateSummary(db, round.id);
    expect(summary.lines).toHaveLength(1);
    expect(summary.lines[0].quantity).toBe(5);
    expect(summary.totalEur).toBeCloseTo(25.0);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm run test --workspace=@tobacconist/server -- summary`
Expected: FAIL — `./summary` module doesn't exist

- [ ] **Step 3: Write `server/src/domain/summary.ts`**

```typescript
import type { Db } from '../db/client';
import { brands, flavors, weights } from '../db/schema';
import { listUserOrderItems, listRoundOrderItems, type OrderItemRow } from './orders';
import { getRound, getRoundPriceSnapshot } from './rounds';
import { isAvailable } from './availability';
import { packPriceEur } from './catalog';

export type AggregateLine = {
  brandId: number;
  brandName: string;
  flavorId: number;
  flavorName: string;
  weightId: number;
  grams: number;
  quantity: number;
  totalEur: number;
};

async function nameLookups(db: Db) {
  const [brandRows, flavorRows, weightRows] = await Promise.all([
    db.select().from(brands).all(),
    db.select().from(flavors).all(),
    db.select().from(weights).all(),
  ]);
  return {
    brandName: (id: number) => brandRows.find((b) => b.id === id)!.name,
    flavorName: (id: number) => flavorRows.find((f) => f.id === id)!.name,
    grams: (id: number) => weightRows.find((w) => w.id === id)!.grams,
  };
}

async function buildLines(
  db: Db,
  roundId: number,
  items: { brandId: number; flavorId: number; weightId: number; quantity: number }[]
): Promise<AggregateLine[]> {
  const lookup = await nameLookups(db);
  const lines: AggregateLine[] = [];
  for (const item of items) {
    const pricePerKg = (await getRoundPriceSnapshot(db, roundId, item.brandId)) ?? 0;
    const grams = lookup.grams(item.weightId);
    const unitPrice = packPriceEur(pricePerKg, grams);
    lines.push({
      brandId: item.brandId,
      brandName: lookup.brandName(item.brandId),
      flavorId: item.flavorId,
      flavorName: lookup.flavorName(item.flavorId),
      weightId: item.weightId,
      grams,
      quantity: item.quantity,
      totalEur: Math.round(unitPrice * item.quantity * 100) / 100,
    });
  }
  return lines;
}

function totals(lines: AggregateLine[]) {
  const totalEur = Math.round(lines.reduce((s, l) => s + l.totalEur, 0) * 100) / 100;
  const totalKg = lines.reduce((s, l) => s + (l.grams * l.quantity) / 1000, 0);
  return { totalEur, totalKg };
}

export async function computeUserSummary(db: Db, roundId: number, userId: number) {
  const round = await getRound(db, roundId);
  if (!round) throw new Error('round not found');
  const items = await listUserOrderItems(db, roundId, userId);
  const lines = await buildLines(db, roundId, items);
  let hasUnavailableItems = false;
  for (const item of items as OrderItemRow[]) {
    if (!(await isAvailable(db, round.vendorId, item.flavorId, item.weightId))) {
      hasUnavailableItems = true;
      break;
    }
  }
  return { items: lines, ...totals(lines), hasUnavailableItems };
}

export async function computeAggregateSummary(db: Db, roundId: number) {
  const items = await listRoundOrderItems(db, roundId);
  const grouped = new Map<string, { brandId: number; flavorId: number; weightId: number; quantity: number }>();
  for (const item of items) {
    const key = `${item.brandId}:${item.flavorId}:${item.weightId}`;
    const existing = grouped.get(key);
    if (existing) existing.quantity += item.quantity;
    else grouped.set(key, { brandId: item.brandId, flavorId: item.flavorId, weightId: item.weightId, quantity: item.quantity });
  }
  const lines = await buildLines(db, roundId, [...grouped.values()]);
  return { lines, ...totals(lines) };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm run test --workspace=@tobacconist/server -- summary`
Expected: PASS (3 tests)

- [ ] **Step 5: Commit**

```bash
git add server/src/domain/summary.ts server/src/domain/summary.test.ts
git commit -m "feat(server): add per-user and aggregate order summary domain"
```

---

### Task 9: Delivery checklist domain

**Files:**
- Create: `server/src/domain/checklist.ts`
- Test: `server/src/domain/checklist.test.ts`

**Interfaces:**
- Consumes: `Db`, `createTestDb` (Task 2); `createVendor`, `setVendorBrandPrice` (Task 3); `createBrand` (Task 3); `replaceAvailability` (Task 4); `openRound` (Task 6); `upsertOrderItem` (Task 7); `computeAggregateSummary` (Task 8)
- Produces:
  - `generateOrUpdateChecklist(db: Db, roundId: number): Promise<void>` — upserts one `DeliveryChecklistItem` per current aggregate line (`expectedQty` = current quantity); for lines that existed before but are no longer in the aggregate, sets `expectedQty` to 0 without touching `receivedQty`; for matching lines, always preserves existing `receivedQty`
  - `listChecklist(db: Db, roundId: number): Promise<ChecklistRow[]>`
  - `adjustReceivedQty(db: Db, checklistItemId: number, delta: number): Promise<ChecklistRow>` — clamps at a minimum of 0
  - Consumed by: Task 17 (rounds API route, called right after `closeRound`), Task 20 (checklist API route)

- [ ] **Step 1: Write the failing tests**

```typescript
// server/src/domain/checklist.test.ts
import { describe, it, expect } from 'vitest';
import { createTestDb } from '../db/client';
import { createVendor, setVendorBrandPrice } from './vendors';
import { createBrand, getWeights } from './catalog';
import { replaceAvailability } from './availability';
import { openRound } from './rounds';
import { upsertOrderItem } from './orders';
import { users } from '../db/schema';
import { generateOrUpdateChecklist, listChecklist, adjustReceivedQty } from './checklist';

async function setup() {
  const db = createTestDb();
  const [admin] = await db.insert(users).values({ telegramId: 'a1', displayName: 'Admin', role: 'admin', firstSeenAt: new Date().toISOString() }).returning().all();
  const vendor = await createVendor(db, 'Vasya');
  const brand = await createBrand(db, 'DarkSide');
  await setVendorBrandPrice(db, vendor.id, brand.id, 20);
  const w250 = (await getWeights(db)).find((w) => w.grams === 250)!;
  const [{ flavorId }] = await replaceAvailability(db, { vendorId: vendor.id, brandId: brand.id, weightId: w250.id, entries: [{ name: 'CyberKiwi', available: true }] });
  const round = await openRound(db, vendor.id, admin.id);
  await upsertOrderItem(db, { roundId: round.id, userId: admin.id, brandId: brand.id, flavorId, weightId: w250.id, quantity: 5 });
  return { db, admin, vendor, brand, w250, flavorId, round };
}

describe('checklist domain', () => {
  it('generates one checklist row per aggregate line with expectedQty set', async () => {
    const { db, round } = await setup();
    await generateOrUpdateChecklist(db, round.id);
    const items = await listChecklist(db, round.id);
    expect(items).toHaveLength(1);
    expect(items[0].expectedQty).toBe(5);
    expect(items[0].receivedQty).toBe(0);
  });

  it('adjustReceivedQty increments and decrements, clamped at 0', async () => {
    const { db, round } = await setup();
    await generateOrUpdateChecklist(db, round.id);
    const [item] = await listChecklist(db, round.id);
    const bumped = await adjustReceivedQty(db, item.id, 1);
    expect(bumped.receivedQty).toBe(1);
    const dropped = await adjustReceivedQty(db, item.id, -5);
    expect(dropped.receivedQty).toBe(0);
  });

  it('regenerating preserves receivedQty for a still-matching line while updating expectedQty', async () => {
    const { db, admin, brand, w250, flavorId, round } = await setup();
    await generateOrUpdateChecklist(db, round.id);
    const [item] = await listChecklist(db, round.id);
    await adjustReceivedQty(db, item.id, 3);

    await upsertOrderItem(db, { roundId: round.id, userId: admin.id, brandId: brand.id, flavorId, weightId: w250.id, quantity: 8 });
    await generateOrUpdateChecklist(db, round.id);

    const [updated] = await listChecklist(db, round.id);
    expect(updated.expectedQty).toBe(8);
    expect(updated.receivedQty).toBe(3);
  });

  it('a line removed from the order sets expectedQty to 0 but keeps receivedQty', async () => {
    const { db, admin, brand, w250, flavorId, round } = await setup();
    await generateOrUpdateChecklist(db, round.id);
    const [item] = await listChecklist(db, round.id);
    await adjustReceivedQty(db, item.id, 2);

    await upsertOrderItem(db, { roundId: round.id, userId: admin.id, brandId: brand.id, flavorId, weightId: w250.id, quantity: 0 });
    await generateOrUpdateChecklist(db, round.id);

    const [updated] = await listChecklist(db, round.id);
    expect(updated.expectedQty).toBe(0);
    expect(updated.receivedQty).toBe(2);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm run test --workspace=@tobacconist/server -- checklist`
Expected: FAIL — `./checklist` module doesn't exist

- [ ] **Step 3: Write `server/src/domain/checklist.ts`**

```typescript
import { eq, and } from 'drizzle-orm';
import type { Db } from '../db/client';
import { deliveryChecklistItems } from '../db/schema';
import { computeAggregateSummary } from './summary';

export type ChecklistRow = typeof deliveryChecklistItems.$inferSelect;

export async function generateOrUpdateChecklist(db: Db, roundId: number) {
  const { lines } = await computeAggregateSummary(db, roundId);
  const existing = await db
    .select()
    .from(deliveryChecklistItems)
    .where(eq(deliveryChecklistItems.roundId, roundId))
    .all();

  const seenIds = new Set<number>();

  for (const line of lines) {
    const match = existing.find(
      (e) => e.brandId === line.brandId && e.flavorId === line.flavorId && e.weightId === line.weightId
    );
    if (match) {
      seenIds.add(match.id);
      await db
        .update(deliveryChecklistItems)
        .set({ expectedQty: line.quantity })
        .where(eq(deliveryChecklistItems.id, match.id))
        .run();
    } else {
      await db
        .insert(deliveryChecklistItems)
        .values({
          roundId,
          brandId: line.brandId,
          flavorId: line.flavorId,
          weightId: line.weightId,
          expectedQty: line.quantity,
          receivedQty: 0,
        })
        .run();
    }
  }

  for (const row of existing) {
    if (!seenIds.has(row.id)) {
      await db
        .update(deliveryChecklistItems)
        .set({ expectedQty: 0 })
        .where(eq(deliveryChecklistItems.id, row.id))
        .run();
    }
  }
}

export async function listChecklist(db: Db, roundId: number) {
  return db.select().from(deliveryChecklistItems).where(eq(deliveryChecklistItems.roundId, roundId)).all();
}

export async function adjustReceivedQty(db: Db, checklistItemId: number, delta: number) {
  const row = await db
    .select()
    .from(deliveryChecklistItems)
    .where(eq(deliveryChecklistItems.id, checklistItemId))
    .get();
  if (!row) throw new Error('checklist item not found');
  const receivedQty = Math.max(0, row.receivedQty + delta);
  const [updated] = await db
    .update(deliveryChecklistItems)
    .set({ receivedQty })
    .where(eq(deliveryChecklistItems.id, checklistItemId))
    .returning()
    .all();
  return updated;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm run test --workspace=@tobacconist/server -- checklist`
Expected: PASS (4 tests)

- [ ] **Step 5: Commit**

```bash
git add server/src/domain/checklist.ts server/src/domain/checklist.test.ts
git commit -m "feat(server): add delivery checklist domain with receivedQty preservation"
```

---

### Task 10: Payments domain

**Files:**
- Create: `server/src/domain/payments.ts`
- Test: `server/src/domain/payments.test.ts`

**Interfaces:**
- Consumes: `Db`, `createTestDb` (Task 2); `users` table (Task 2)
- Produces:
  - `setPaymentStatus(db: Db, roundId: number, userId: number, paid: boolean, markedByUserId: number): Promise<{ roundId: number; userId: number; paid: boolean }>`
  - `getPaymentStatus(db: Db, roundId: number, userId: number): Promise<boolean>` — defaults to `false` when no row exists
  - `listPayments(db: Db, roundId: number): Promise<{ userId: number; displayName: string; paid: boolean }[]>`
  - Consumed by: Task 19/21 (API routes, merged into `UserSummaryDto`/`PaymentDto`)

- [ ] **Step 1: Write the failing tests**

```typescript
// server/src/domain/payments.test.ts
import { describe, it, expect } from 'vitest';
import { createTestDb } from '../db/client';
import { users } from '../db/schema';
import { setPaymentStatus, getPaymentStatus, listPayments } from './payments';

async function setup() {
  const db = createTestDb();
  const [admin] = await db.insert(users).values({ telegramId: 'a1', displayName: 'Admin', role: 'admin', firstSeenAt: new Date().toISOString() }).returning().all();
  const [friend] = await db.insert(users).values({ telegramId: 'f1', displayName: 'Friend', role: 'member', firstSeenAt: new Date().toISOString() }).returning().all();
  return { db, admin, friend };
}

describe('payments domain', () => {
  it('defaults to unpaid when no row exists', async () => {
    const { db, friend } = await setup();
    expect(await getPaymentStatus(db, 1, friend.id)).toBe(false);
  });

  it('setPaymentStatus upserts and getPaymentStatus reflects it', async () => {
    const { db, admin, friend } = await setup();
    await setPaymentStatus(db, 1, friend.id, true, admin.id);
    expect(await getPaymentStatus(db, 1, friend.id)).toBe(true);
    await setPaymentStatus(db, 1, friend.id, false, admin.id);
    expect(await getPaymentStatus(db, 1, friend.id)).toBe(false);
  });

  it('listPayments returns display names alongside paid status', async () => {
    const { db, admin, friend } = await setup();
    await setPaymentStatus(db, 1, friend.id, true, admin.id);
    const rows = await listPayments(db, 1);
    expect(rows).toEqual([{ userId: friend.id, displayName: 'Friend', paid: true }]);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm run test --workspace=@tobacconist/server -- payments`
Expected: FAIL — `./payments` module doesn't exist

- [ ] **Step 3: Write `server/src/domain/payments.ts`**

```typescript
import { eq, and } from 'drizzle-orm';
import type { Db } from '../db/client';
import { roundPayments, users } from '../db/schema';

export async function setPaymentStatus(
  db: Db,
  roundId: number,
  userId: number,
  paid: boolean,
  markedByUserId: number
) {
  const existing = await db
    .select()
    .from(roundPayments)
    .where(and(eq(roundPayments.roundId, roundId), eq(roundPayments.userId, userId)))
    .get();
  const now = new Date().toISOString();
  if (existing) {
    await db
      .update(roundPayments)
      .set({ paid, markedAt: now, markedByUserId })
      .where(eq(roundPayments.id, existing.id))
      .run();
  } else {
    await db.insert(roundPayments).values({ roundId, userId, paid, markedAt: now, markedByUserId }).run();
  }
  return { roundId, userId, paid };
}

export async function getPaymentStatus(db: Db, roundId: number, userId: number) {
  const row = await db
    .select()
    .from(roundPayments)
    .where(and(eq(roundPayments.roundId, roundId), eq(roundPayments.userId, userId)))
    .get();
  return row?.paid ?? false;
}

export async function listPayments(db: Db, roundId: number) {
  const rows = await db
    .select({ userId: roundPayments.userId, displayName: users.displayName, paid: roundPayments.paid })
    .from(roundPayments)
    .innerJoin(users, eq(users.id, roundPayments.userId))
    .where(eq(roundPayments.roundId, roundId))
    .all();
  return rows;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm run test --workspace=@tobacconist/server -- payments`
Expected: PASS (3 tests)

- [ ] **Step 5: Commit**

```bash
git add server/src/domain/payments.ts server/src/domain/payments.test.ts
git commit -m "feat(server): add payment status domain"
```

---

### Task 11: Snapshot text & table builders

**Files:**
- Create: `server/src/domain/snapshot.ts`
- Test: `server/src/domain/snapshot.test.ts`

**Interfaces:**
- Consumes: `AggregateLine` type (Task 8, `summary.ts`) — pure functions, no DB access
- Produces:
  - `buildTextSnapshot(lines: AggregateLine[]): string` — brand-grouped, one line per (flavor, weight): `"Brand - Flavor - Weight - xQty"`
  - `buildTableSnapshot(lines: AggregateLine[]): { brand: string; flavor: string; weight: string; quantity: number; totalEur: number }[]`
  - Consumed by: Task 19 (snapshot API route), Task 12 (`xlsx.ts` consumes `buildTableSnapshot`'s output shape)

- [ ] **Step 1: Write the failing tests**

```typescript
// server/src/domain/snapshot.test.ts
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
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm run test --workspace=@tobacconist/server -- snapshot`
Expected: FAIL — `./snapshot` module doesn't exist

- [ ] **Step 3: Write `server/src/domain/snapshot.ts`**

```typescript
import type { AggregateLine } from './summary';

function sortedLines(lines: AggregateLine[]): AggregateLine[] {
  return [...lines].sort((a, b) => {
    if (a.brandName !== b.brandName) return a.brandName.localeCompare(b.brandName);
    if (a.flavorName !== b.flavorName) return a.flavorName.localeCompare(b.flavorName);
    return a.grams - b.grams;
  });
}

export function buildTextSnapshot(lines: AggregateLine[]): string {
  const sorted = sortedLines(lines);
  const blocks: string[] = [];
  let currentBrand: string | null = null;
  let currentLines: string[] = [];

  for (const line of sorted) {
    if (line.brandName !== currentBrand) {
      if (currentBrand !== null) {
        blocks.push([currentBrand, ...currentLines].join('\n'));
      }
      currentBrand = line.brandName;
      currentLines = [];
    }
    currentLines.push(`${line.brandName} - ${line.flavorName} - ${line.grams}g - x${line.quantity}`);
  }
  if (currentBrand !== null) {
    blocks.push([currentBrand, ...currentLines].join('\n'));
  }

  return blocks.join('\n\n');
}

export function buildTableSnapshot(lines: AggregateLine[]) {
  return sortedLines(lines).map((line) => ({
    brand: line.brandName,
    flavor: line.flavorName,
    weight: `${line.grams}g`,
    quantity: line.quantity,
    totalEur: line.totalEur,
  }));
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm run test --workspace=@tobacconist/server -- snapshot`
Expected: PASS (2 tests)

- [ ] **Step 5: Commit**

```bash
git add server/src/domain/snapshot.ts server/src/domain/snapshot.test.ts
git commit -m "feat(server): add text and table snapshot builders"
```

---

### Task 12: XLSX export builder

**Files:**
- Create: `server/src/domain/xlsx.ts`
- Test: `server/src/domain/xlsx.test.ts`

**Interfaces:**
- Consumes: the row shape produced by `buildTableSnapshot` (Task 11): `{ brand: string; flavor: string; weight: string; quantity: number; totalEur: number }`
- Produces: `buildSnapshotWorkbook(rows: TableRow[]): Promise<Buffer>`
- Consumed by: Task 19 (snapshot API route, sent as a Telegram document via `notify.ts`)

- [ ] **Step 1: Write the failing test**

```typescript
// server/src/domain/xlsx.test.ts
import { describe, it, expect } from 'vitest';
import ExcelJS from 'exceljs';
import { buildSnapshotWorkbook } from './xlsx';

describe('buildSnapshotWorkbook', () => {
  it('writes a header row, data rows, and a total row', async () => {
    const buffer = await buildSnapshotWorkbook([
      { brand: 'DarkSide', flavor: 'CyberKiwi', weight: '250g', quantity: 3, totalEur: 15 },
    ]);
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(buffer);
    const sheet = workbook.getWorksheet('Order')!;
    expect(sheet.getRow(1).getCell(1).value).toBe('Brand');
    expect(sheet.getRow(2).getCell(1).value).toBe('DarkSide');
    expect(sheet.getRow(2).getCell(4).value).toBe(3);
    expect(sheet.getRow(3).getCell(5).value).toBe(15);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test --workspace=@tobacconist/server -- xlsx`
Expected: FAIL — `./xlsx` module doesn't exist

- [ ] **Step 3: Write `server/src/domain/xlsx.ts`**

```typescript
import ExcelJS from 'exceljs';

export type TableRow = { brand: string; flavor: string; weight: string; quantity: number; totalEur: number };

export async function buildSnapshotWorkbook(rows: TableRow[]): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('Order');
  sheet.columns = [
    { header: 'Brand', key: 'brand', width: 20 },
    { header: 'Flavor', key: 'flavor', width: 24 },
    { header: 'Weight', key: 'weight', width: 10 },
    { header: 'Quantity', key: 'quantity', width: 10 },
    { header: 'Total EUR', key: 'totalEur', width: 12 },
  ];
  sheet.addRows(rows);
  const totalEur = Math.round(rows.reduce((s, r) => s + r.totalEur, 0) * 100) / 100;
  sheet.addRow({ brand: '', flavor: '', weight: '', quantity: null, totalEur });
  const buffer = await workbook.xlsx.writeBuffer();
  return Buffer.from(buffer);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test --workspace=@tobacconist/server -- xlsx`
Expected: PASS (1 test)

- [ ] **Step 5: Commit**

```bash
git add server/src/domain/xlsx.ts server/src/domain/xlsx.test.ts
git commit -m "feat(server): add XLSX snapshot export builder"
```

---

### Task 13: Telegram initData verification & group membership check

**Files:**
- Create: `server/src/telegram/auth.ts`
- Test: `server/src/telegram/auth.test.ts`

**Interfaces:**
- Consumes: nothing from earlier tasks (pure crypto + injectable API client)
- Produces:
  - `verifyInitData(params: { initData: string; botToken: string; maxAgeSeconds?: number; now?: Date }): { ok: true; telegramId: string; displayName: string } | { ok: false; reason: string }`
  - `interface ChatMemberApi { getChatMember(chatId: string | number, userId: number): Promise<{ status: string }> }`
  - `checkGroupMembership(api: ChatMemberApi, groupChatId: string, telegramUserId: number): Promise<boolean>`
  - Consumed by: Task 14 (`authenticate` middleware)

- [ ] **Step 1: Write the failing tests**

```typescript
// server/src/telegram/auth.test.ts
import { describe, it, expect } from 'vitest';
import crypto from 'node:crypto';
import { verifyInitData, checkGroupMembership, type ChatMemberApi } from './auth';

const BOT_TOKEN = '123456:TEST-TOKEN';

function buildInitData(overrides: { authDate?: number; user?: object } = {}) {
  const params = new URLSearchParams();
  params.set('auth_date', String(overrides.authDate ?? Math.floor(Date.now() / 1000)));
  params.set(
    'user',
    JSON.stringify(overrides.user ?? { id: 555, first_name: 'Ann', last_name: 'K' })
  );
  const pairs = [...params.entries()].sort(([a], [b]) => a.localeCompare(b));
  const dataCheckString = pairs.map(([k, v]) => `${k}=${v}`).join('\n');
  const secretKey = crypto.createHmac('sha256', 'WebAppData').update(BOT_TOKEN).digest();
  const hash = crypto.createHmac('sha256', secretKey).update(dataCheckString).digest('hex');
  params.set('hash', hash);
  return params.toString();
}

describe('verifyInitData', () => {
  it('accepts a correctly signed payload and extracts the user', () => {
    const initData = buildInitData();
    const result = verifyInitData({ initData, botToken: BOT_TOKEN });
    expect(result).toEqual({ ok: true, telegramId: '555', displayName: 'Ann K' });
  });

  it('rejects a tampered payload', () => {
    const initData = buildInitData().replace('Ann', 'Bob');
    const result = verifyInitData({ initData, botToken: BOT_TOKEN });
    expect(result.ok).toBe(false);
  });

  it('rejects an expired auth_date', () => {
    const initData = buildInitData({ authDate: Math.floor(Date.now() / 1000) - 100000 });
    const result = verifyInitData({ initData, botToken: BOT_TOKEN, maxAgeSeconds: 86400 });
    expect(result).toEqual({ ok: false, reason: 'expired' });
  });
});

describe('checkGroupMembership', () => {
  it('returns true for an active member', async () => {
    const api: ChatMemberApi = { getChatMember: async () => ({ status: 'member' }) };
    expect(await checkGroupMembership(api, '-100123', 555)).toBe(true);
  });

  it('returns false for someone who left', async () => {
    const api: ChatMemberApi = { getChatMember: async () => ({ status: 'left' }) };
    expect(await checkGroupMembership(api, '-100123', 555)).toBe(false);
  });

  it('returns false when the API call fails', async () => {
    const api: ChatMemberApi = {
      getChatMember: async () => {
        throw new Error('boom');
      },
    };
    expect(await checkGroupMembership(api, '-100123', 555)).toBe(false);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm run test --workspace=@tobacconist/server -- telegram/auth`
Expected: FAIL — `./auth` module doesn't exist

- [ ] **Step 3: Write `server/src/telegram/auth.ts`**

```typescript
import crypto from 'node:crypto';

export type InitDataResult =
  | { ok: true; telegramId: string; displayName: string }
  | { ok: false; reason: string };

export function verifyInitData(params: {
  initData: string;
  botToken: string;
  maxAgeSeconds?: number;
  now?: Date;
}): InitDataResult {
  const { initData, botToken, maxAgeSeconds = 86400, now = new Date() } = params;

  const parsed = new URLSearchParams(initData);
  const hash = parsed.get('hash');
  if (!hash) return { ok: false, reason: 'missing hash' };
  parsed.delete('hash');

  const pairs = [...parsed.entries()].sort(([a], [b]) => a.localeCompare(b));
  const dataCheckString = pairs.map(([k, v]) => `${k}=${v}`).join('\n');

  const secretKey = crypto.createHmac('sha256', 'WebAppData').update(botToken).digest();
  const computedHash = crypto.createHmac('sha256', secretKey).update(dataCheckString).digest('hex');

  if (computedHash !== hash) return { ok: false, reason: 'invalid signature' };

  const authDate = Number(parsed.get('auth_date'));
  if (!authDate || now.getTime() / 1000 - authDate > maxAgeSeconds) {
    return { ok: false, reason: 'expired' };
  }

  const userJson = parsed.get('user');
  if (!userJson) return { ok: false, reason: 'missing user' };

  let user: { id: number; first_name?: string; last_name?: string; username?: string };
  try {
    user = JSON.parse(userJson);
  } catch {
    return { ok: false, reason: 'invalid user json' };
  }

  const displayName =
    [user.first_name, user.last_name].filter(Boolean).join(' ') || user.username || String(user.id);

  return { ok: true, telegramId: String(user.id), displayName };
}

export interface ChatMemberApi {
  getChatMember(chatId: string | number, userId: number): Promise<{ status: string }>;
}

export async function checkGroupMembership(
  api: ChatMemberApi,
  groupChatId: string,
  telegramUserId: number
): Promise<boolean> {
  try {
    const member = await api.getChatMember(groupChatId, telegramUserId);
    return !['left', 'kicked'].includes(member.status);
  } catch {
    return false;
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm run test --workspace=@tobacconist/server -- telegram/auth`
Expected: PASS (6 tests)

- [ ] **Step 5: Commit**

```bash
git add server/src/telegram/auth.ts server/src/telegram/auth.test.ts
git commit -m "feat(server): add Telegram initData verification and group membership check"
```

---

### Task 14: Config, Fastify app skeleton, and auth middleware

**Files:**
- Create: `server/src/config.ts`
- Create: `server/src/api/middleware/authenticate.ts`
- Create: `server/src/api/app.ts`
- Test: `server/src/api/middleware/authenticate.test.ts`
- Test: `server/src/api/app.test.ts`

**Interfaces:**
- Consumes: `Db`, `createTestDb`, `schema.users` (Task 2); `verifyInitData`, `checkGroupMembership`, `ChatMemberApi` (Task 13)
- Produces:
  - `loadConfig(env?: NodeJS.ProcessEnv): Config` where `Config = { botToken, adminTelegramId, groupChatId, geminiApiKey, dbPath, port, publicUrl }`
  - `createAuthenticate(deps: { db: Db; botToken: string; groupChatId: string; adminTelegramId: string; chatMemberApi: ChatMemberApi }): (req: FastifyRequest, reply: FastifyReply) => Promise<void>` — sets `req.authedUser: { id, telegramId, displayName, role }` on success
  - `requireAdmin(req: FastifyRequest, reply: FastifyReply, done: (err?: Error) => void)`
  - `buildApp(deps: { db: Db; botToken: string; groupChatId: string; adminTelegramId: string; chatMemberApi: ChatMemberApi; miniAppDistPath?: string }): FastifyInstance` — all `/api/*` routes (registered in later tasks) run behind `authenticate`; `GET /api/health` is exempt
  - Consumed by: Task 15-21 (route plugins register under the app's `/api` encapsulated context), Task 23 (server entrypoint calls `buildApp`)

- [ ] **Step 1: Write `server/src/config.ts`**

```typescript
export type Config = {
  botToken: string;
  adminTelegramId: string;
  groupChatId: string;
  geminiApiKey: string;
  dbPath: string;
  port: number;
  publicUrl: string;
};

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  function required(key: string): string {
    const value = env[key];
    if (!value) throw new Error(`missing required env var ${key}`);
    return value;
  }
  return {
    botToken: required('BOT_TOKEN'),
    adminTelegramId: required('TELEGRAM_ADMIN_ID'),
    groupChatId: required('TELEGRAM_GROUP_CHAT_ID'),
    geminiApiKey: required('GEMINI_API_KEY'),
    dbPath: env.DB_PATH ?? './data/tobacconist.sqlite3',
    port: Number(env.PORT ?? 3000),
    publicUrl: required('PUBLIC_URL'),
  };
}
```

- [ ] **Step 2: Write the failing tests for the auth middleware**

```typescript
// server/src/api/middleware/authenticate.test.ts
import { describe, it, expect } from 'vitest';
import Fastify from 'fastify';
import crypto from 'node:crypto';
import { createTestDb } from '../../db/client';
import { createAuthenticate, requireAdmin } from './authenticate';
import type { ChatMemberApi } from '../../telegram/auth';

const BOT_TOKEN = '123456:TEST-TOKEN';

function signedInitData(userId: number) {
  const params = new URLSearchParams();
  params.set('auth_date', String(Math.floor(Date.now() / 1000)));
  params.set('user', JSON.stringify({ id: userId, first_name: 'Ann' }));
  const pairs = [...params.entries()].sort(([a], [b]) => a.localeCompare(b));
  const dataCheckString = pairs.map(([k, v]) => `${k}=${v}`).join('\n');
  const secretKey = crypto.createHmac('sha256', 'WebAppData').update(BOT_TOKEN).digest();
  const hash = crypto.createHmac('sha256', secretKey).update(dataCheckString).digest('hex');
  params.set('hash', hash);
  return params.toString();
}

function buildTestApp(opts: { memberStatus: string; adminTelegramId: string }) {
  const db = createTestDb();
  const chatMemberApi: ChatMemberApi = { getChatMember: async () => ({ status: opts.memberStatus }) };
  const authenticate = createAuthenticate({
    db,
    botToken: BOT_TOKEN,
    groupChatId: '-1001',
    adminTelegramId: opts.adminTelegramId,
    chatMemberApi,
  });
  const app = Fastify();
  app.get('/whoami', { preHandler: authenticate }, async (req) => req.authedUser);
  app.get('/admin-only', { preHandler: [authenticate, requireAdmin] }, async () => ({ ok: true }));
  return app;
}

describe('authenticate middleware', () => {
  it('401s when the init-data header is missing', async () => {
    const app = buildTestApp({ memberStatus: 'member', adminTelegramId: '999' });
    const res = await app.inject({ method: 'GET', url: '/whoami' });
    expect(res.statusCode).toBe(401);
  });

  it('403s when the user is not a group member', async () => {
    const app = buildTestApp({ memberStatus: 'left', adminTelegramId: '999' });
    const res = await app.inject({
      method: 'GET',
      url: '/whoami',
      headers: { 'x-telegram-init-data': signedInitData(555) },
    });
    expect(res.statusCode).toBe(403);
  });

  it('creates the user on first sight and assigns admin role by telegram id', async () => {
    const app = buildTestApp({ memberStatus: 'member', adminTelegramId: '555' });
    const res = await app.inject({
      method: 'GET',
      url: '/whoami',
      headers: { 'x-telegram-init-data': signedInitData(555) },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ telegramId: '555', role: 'admin', displayName: 'Ann' });
  });

  it('requireAdmin blocks a member-role user', async () => {
    const app = buildTestApp({ memberStatus: 'member', adminTelegramId: '999' });
    const res = await app.inject({
      method: 'GET',
      url: '/admin-only',
      headers: { 'x-telegram-init-data': signedInitData(555) },
    });
    expect(res.statusCode).toBe(403);
  });
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `npm run test --workspace=@tobacconist/server -- api/middleware/authenticate`
Expected: FAIL — `./authenticate` module doesn't exist

- [ ] **Step 4: Write `server/src/api/middleware/authenticate.ts`**

```typescript
import type { FastifyRequest, FastifyReply } from 'fastify';
import { eq } from 'drizzle-orm';
import type { Db } from '../../db/client';
import { users } from '../../db/schema';
import { verifyInitData, checkGroupMembership, type ChatMemberApi } from '../../telegram/auth';

export type AuthedUser = { id: number; telegramId: string; displayName: string; role: 'admin' | 'member' };

declare module 'fastify' {
  interface FastifyRequest {
    authedUser?: AuthedUser;
  }
}

export function createAuthenticate(deps: {
  db: Db;
  botToken: string;
  groupChatId: string;
  adminTelegramId: string;
  chatMemberApi: ChatMemberApi;
}) {
  return async function authenticate(req: FastifyRequest, reply: FastifyReply) {
    const initData = req.headers['x-telegram-init-data'];
    if (typeof initData !== 'string') {
      reply.code(401).send({ error: 'missing X-Telegram-Init-Data header' });
      return;
    }

    const verified = verifyInitData({ initData, botToken: deps.botToken });
    if (!verified.ok) {
      reply.code(401).send({ error: verified.reason });
      return;
    }

    const isMember = await checkGroupMembership(
      deps.chatMemberApi,
      deps.groupChatId,
      Number(verified.telegramId)
    );
    if (!isMember) {
      reply.code(403).send({ error: 'not a member of the group chat' });
      return;
    }

    const role: 'admin' | 'member' = verified.telegramId === deps.adminTelegramId ? 'admin' : 'member';
    const existing = await deps.db.select().from(users).where(eq(users.telegramId, verified.telegramId)).get();

    let row;
    if (existing) {
      if (existing.role !== role || existing.displayName !== verified.displayName) {
        [row] = await deps.db
          .update(users)
          .set({ role, displayName: verified.displayName })
          .where(eq(users.id, existing.id))
          .returning()
          .all();
      } else {
        row = existing;
      }
    } else {
      [row] = await deps.db
        .insert(users)
        .values({
          telegramId: verified.telegramId,
          displayName: verified.displayName,
          role,
          firstSeenAt: new Date().toISOString(),
        })
        .returning()
        .all();
    }

    req.authedUser = { id: row.id, telegramId: row.telegramId, displayName: row.displayName, role: row.role as 'admin' | 'member' };
  };
}

export function requireAdmin(req: FastifyRequest, reply: FastifyReply, done: (err?: Error) => void) {
  if (req.authedUser?.role !== 'admin') {
    reply.code(403).send({ error: 'admin only' });
    return;
  }
  done();
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npm run test --workspace=@tobacconist/server -- api/middleware/authenticate`
Expected: PASS (4 tests)

- [ ] **Step 6: Write the failing test for the app skeleton**

```typescript
// server/src/api/app.test.ts
import { describe, it, expect } from 'vitest';
import { createTestDb } from '../db/client';
import { buildApp } from './app';
import type { ChatMemberApi } from '../telegram/auth';

describe('buildApp', () => {
  it('exposes GET /api/health without requiring auth', async () => {
    const chatMemberApi: ChatMemberApi = { getChatMember: async () => ({ status: 'member' }) };
    const app = buildApp({
      db: createTestDb(),
      botToken: 'x',
      groupChatId: '-1001',
      adminTelegramId: '1',
      chatMemberApi,
    });
    const res = await app.inject({ method: 'GET', url: '/api/health' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ status: 'ok' });
  });
});
```

- [ ] **Step 7: Run test to verify it fails**

Run: `npm run test --workspace=@tobacconist/server -- api/app`
Expected: FAIL — `./app` module doesn't exist

- [ ] **Step 8: Write `server/src/api/app.ts`**

```typescript
import Fastify, { type FastifyInstance } from 'fastify';
import multipart from '@fastify/multipart';
import fastifyStatic from '@fastify/static';
import type { Db } from '../db/client';
import { createAuthenticate } from './middleware/authenticate';
import type { ChatMemberApi } from '../telegram/auth';

export function buildApp(deps: {
  db: Db;
  botToken: string;
  groupChatId: string;
  adminTelegramId: string;
  chatMemberApi: ChatMemberApi;
  miniAppDistPath?: string;
}): FastifyInstance {
  const app = Fastify({ logger: true });
  app.register(multipart);

  if (deps.miniAppDistPath) {
    app.register(fastifyStatic, { root: deps.miniAppDistPath });
  }

  app.get('/api/health', async () => ({ status: 'ok' }));

  const authenticate = createAuthenticate({
    db: deps.db,
    botToken: deps.botToken,
    groupChatId: deps.groupChatId,
    adminTelegramId: deps.adminTelegramId,
    chatMemberApi: deps.chatMemberApi,
  });

  app.register(
    async (api) => {
      api.addHook('preHandler', authenticate);
      api.decorate('db', deps.db);
      // route plugins are registered here by Tasks 15-21
    },
    { prefix: '/api' }
  );

  return app;
}
```

- [ ] **Step 9: Run test to verify it passes**

Run: `npm run test --workspace=@tobacconist/server -- api/app`
Expected: PASS (1 test)

- [ ] **Step 10: Commit**

```bash
git add server/src/config.ts server/src/api/
git commit -m "feat(server): add config loader, Fastify app skeleton, and auth middleware"
```

---

### Task 15: API routes — catalog, vendors, prices (admin)

**Files:**
- Create: `server/src/api/routes/catalog.ts`
- Modify: `server/src/api/app.ts` (register the route plugin)
- Test: `server/src/api/routes/catalog.test.ts`

**Interfaces:**
- Consumes: `Db` (Task 2); `getWeights`, `createBrand`, `listBrands` (Task 3); `createVendor`, `listVendors`, `archiveVendor`, `setVendorBrandPrice`, `getVendorBrandPrices` (Task 3); `requireAdmin`, `AuthedUser` (Task 14)
- Produces: `catalogRoutes(db: Db): FastifyPluginAsync`, mounted at `/api/admin` — `GET /weights`, `GET|POST /brands`, `GET|POST /vendors`, `POST /vendors/:vendorId/archive`, `GET /vendors/:vendorId/prices`, `PUT /vendors/:vendorId/prices/:brandId`
- Consumed by: `server/src/api/app.ts`; Mini App admin catalog/price screens (Task 25)

- [ ] **Step 1: Write the failing tests**

```typescript
// server/src/api/routes/catalog.test.ts
import { describe, it, expect } from 'vitest';
import Fastify from 'fastify';
import { createTestDb } from '../../db/client';
import { catalogRoutes } from './catalog';
import type { AuthedUser } from '../middleware/authenticate';

function testApp(user: AuthedUser) {
  const db = createTestDb();
  const app = Fastify();
  app.addHook('preHandler', async (req) => {
    req.authedUser = user;
  });
  app.register(catalogRoutes(db), { prefix: '/api/admin' });
  return { app, db };
}

const admin: AuthedUser = { id: 1, telegramId: '1', displayName: 'Admin', role: 'admin' };
const member: AuthedUser = { id: 2, telegramId: '2', displayName: 'Friend', role: 'member' };

describe('catalog routes', () => {
  it('GET /weights returns the fixed set', async () => {
    const { app } = testApp(admin);
    const res = await app.inject({ method: 'GET', url: '/api/admin/weights' });
    expect(res.statusCode).toBe(200);
    expect(res.json().map((w: any) => w.grams).sort()).toEqual([100, 250]);
  });

  it('POST /brands creates a brand, GET /brands lists it', async () => {
    const { app } = testApp(admin);
    const create = await app.inject({ method: 'POST', url: '/api/admin/brands', payload: { name: 'DarkSide' } });
    expect(create.statusCode).toBe(201);
    const list = await app.inject({ method: 'GET', url: '/api/admin/brands' });
    expect(list.json()).toEqual([{ id: 1, name: 'DarkSide' }]);
  });

  it('vendor + price flow: create vendor, set price, read it back', async () => {
    const { app } = testApp(admin);
    const vendorRes = await app.inject({ method: 'POST', url: '/api/admin/vendors', payload: { name: 'Vasya' } });
    const vendor = vendorRes.json();
    const brandRes = await app.inject({ method: 'POST', url: '/api/admin/brands', payload: { name: 'DarkSide' } });
    const brand = brandRes.json();
    await app.inject({
      method: 'PUT',
      url: `/api/admin/vendors/${vendor.id}/prices/${brand.id}`,
      payload: { pricePerKgEur: 20 },
    });
    const prices = await app.inject({ method: 'GET', url: `/api/admin/vendors/${vendor.id}/prices` });
    expect(prices.json()).toEqual([
      { vendorId: vendor.id, brandId: brand.id, brandName: 'DarkSide', pricePerKgEur: 20 },
    ]);
  });

  it('rejects a non-admin user with 403', async () => {
    const { app } = testApp(member);
    const res = await app.inject({ method: 'GET', url: '/api/admin/brands' });
    expect(res.statusCode).toBe(403);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm run test --workspace=@tobacconist/server -- routes/catalog`
Expected: FAIL — `./catalog` route module doesn't exist

- [ ] **Step 3: Write `server/src/api/routes/catalog.ts`**

```typescript
import type { FastifyInstance } from 'fastify';
import type { Db } from '../../db/client';
import { requireAdmin } from '../middleware/authenticate';
import { getWeights, createBrand, listBrands } from '../../domain/catalog';
import {
  createVendor,
  listVendors,
  archiveVendor,
  setVendorBrandPrice,
  getVendorBrandPrices,
} from '../../domain/vendors';

export function catalogRoutes(db: Db) {
  return async function routes(api: FastifyInstance) {
    api.addHook('preHandler', requireAdmin);

    api.get('/weights', async () => getWeights(db));

    api.get('/brands', async () => listBrands(db));

    api.post<{ Body: { name: string } }>('/brands', async (req, reply) => {
      const brand = await createBrand(db, req.body.name);
      reply.code(201).send(brand);
    });

    api.get<{ Querystring: { includeArchived?: string } }>('/vendors', async (req) => {
      return listVendors(db, { includeArchived: req.query.includeArchived === 'true' });
    });

    api.post<{ Body: { name: string } }>('/vendors', async (req, reply) => {
      const vendor = await createVendor(db, req.body.name);
      reply.code(201).send(vendor);
    });

    api.post<{ Params: { vendorId: string } }>('/vendors/:vendorId/archive', async (req, reply) => {
      await archiveVendor(db, Number(req.params.vendorId));
      reply.code(204).send();
    });

    api.get<{ Params: { vendorId: string } }>('/vendors/:vendorId/prices', async (req) => {
      return getVendorBrandPrices(db, Number(req.params.vendorId));
    });

    api.put<{ Params: { vendorId: string; brandId: string }; Body: { pricePerKgEur: number } }>(
      '/vendors/:vendorId/prices/:brandId',
      async (req) => {
        return setVendorBrandPrice(
          db,
          Number(req.params.vendorId),
          Number(req.params.brandId),
          req.body.pricePerKgEur
        );
      }
    );
  };
}
```

- [ ] **Step 4: Register the route plugin in `server/src/api/app.ts`**

```typescript
// Replace the "// route plugins are registered here by Tasks 15-21" comment with:
      api.register(catalogRoutes(deps.db), { prefix: '/admin' });
```

Also add the import at the top of `server/src/api/app.ts`:

```typescript
import { catalogRoutes } from './routes/catalog';
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npm run test --workspace=@tobacconist/server -- routes/catalog`
Expected: PASS (4 tests)

- [ ] **Step 6: Commit**

```bash
git add server/src/api/routes/catalog.ts server/src/api/routes/catalog.test.ts server/src/api/app.ts
git commit -m "feat(server): add admin catalog/vendor/price API routes"
```

---

### Task 16: API route — availability upload (parse + confirm)

**Files:**
- Create: `server/src/api/routes/availability.ts`
- Modify: `server/src/api/app.ts` (add `geminiClient`/`uploadsDir` deps, register route plugin)
- Test: `server/src/api/routes/availability.test.ts`

**Interfaces:**
- Consumes: `Db` (Task 2); `availabilityUploads` table (Task 2); `replaceAvailability` (Task 4); `GeminiClient`, `parseAvailabilityImage` (Task 5); `requireAdmin` (Task 14)
- Produces: `availabilityRoutes(db: Db, geminiClient: GeminiClient, uploadsDir: string): FastifyPluginAsync`, mounted at `/api/admin/availability` — `POST /parse` (multipart: `image` file + `vendorId`/`brandId`/`weightId` fields, returns proposed `{ name, available }[]` without saving), `POST /confirm` (JSON body, saves via `replaceAvailability`)
- Consumed by: `server/src/api/app.ts`; Mini App admin availability-upload screen (Task 25)

- [ ] **Step 1: Add the `form-data` dev dependency for multipart tests**

Modify `server/package.json` devDependencies to add:
```json
"form-data": "^4.0.0"
```
Run: `npm install`

- [ ] **Step 2: Write the failing tests**

```typescript
// server/src/api/routes/availability.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Fastify from 'fastify';
import multipart from '@fastify/multipart';
import FormData from 'form-data';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createTestDb } from '../../db/client';
import { createVendor } from '../../domain/vendors';
import { createBrand, getWeights } from '../../domain/catalog';
import { availabilityRoutes } from './availability';
import type { AuthedUser } from '../middleware/authenticate';
import type { GeminiClient } from '../../gemini/client';

const admin: AuthedUser = { id: 1, telegramId: '1', displayName: 'Admin', role: 'admin' };
const member: AuthedUser = { id: 2, telegramId: '2', displayName: 'Friend', role: 'member' };

let uploadsDir: string;

beforeEach(async () => {
  uploadsDir = await fs.mkdtemp(path.join(os.tmpdir(), 'tobacconist-uploads-'));
});

afterEach(async () => {
  await fs.rm(uploadsDir, { recursive: true, force: true });
});

function testApp(user: AuthedUser, geminiResponse: string) {
  const db = createTestDb();
  const geminiClient: GeminiClient = { generateFromImage: async () => geminiResponse };
  const app = Fastify();
  app.register(multipart);
  app.addHook('preHandler', async (req) => {
    req.authedUser = user;
  });
  app.register(availabilityRoutes(db, geminiClient, uploadsDir), { prefix: '/api/admin/availability' });
  return { app, db };
}

describe('availability routes', () => {
  it('POST /parse returns proposed entries and records an audit upload row', async () => {
    const { app, db } = testApp(
      admin,
      JSON.stringify([{ name: 'CyberKiwi', available: true }, { name: 'Mango', available: false }])
    );
    const vendor = await createVendor(db, 'Vasya');
    const brand = await createBrand(db, 'DarkSide');
    const w250 = (await getWeights(db)).find((w) => w.grams === 250)!;

    const form = new FormData();
    form.append('vendorId', String(vendor.id));
    form.append('brandId', String(brand.id));
    form.append('weightId', String(w250.id));
    form.append('image', Buffer.from('fake-bytes'), { filename: 'photo.jpg', contentType: 'image/jpeg' });

    const res = await app.inject({
      method: 'POST',
      url: '/api/admin/availability/parse',
      payload: form,
      headers: form.getHeaders(),
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      entries: [
        { name: 'CyberKiwi', available: true },
        { name: 'Mango', available: false },
      ],
    });
    const savedFiles = await fs.readdir(uploadsDir);
    expect(savedFiles).toHaveLength(1);
  });

  it('POST /confirm saves availability and returns entries with assigned flavor ids', async () => {
    const { app, db } = testApp(admin, '[]');
    const vendor = await createVendor(db, 'Vasya');
    const brand = await createBrand(db, 'DarkSide');
    const w250 = (await getWeights(db)).find((w) => w.grams === 250)!;

    const res = await app.inject({
      method: 'POST',
      url: '/api/admin/availability/confirm',
      payload: {
        vendorId: vendor.id,
        brandId: brand.id,
        weightId: w250.id,
        entries: [{ name: 'CyberKiwi', available: true }],
      },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual([{ flavorId: expect.any(Number), flavorName: 'CyberKiwi', available: true }]);
  });

  it('rejects a non-admin user with 403', async () => {
    const { app } = testApp(member, '[]');
    const res = await app.inject({
      method: 'POST',
      url: '/api/admin/availability/confirm',
      payload: { vendorId: 1, brandId: 1, weightId: 1, entries: [] },
    });
    expect(res.statusCode).toBe(403);
  });
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `npm run test --workspace=@tobacconist/server -- routes/availability`
Expected: FAIL — `./availability` route module doesn't exist

- [ ] **Step 4: Write `server/src/api/routes/availability.ts`**

```typescript
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import type { Db } from '../../db/client';
import { availabilityUploads } from '../../db/schema';
import { requireAdmin } from '../middleware/authenticate';
import { replaceAvailability } from '../../domain/availability';
import { parseAvailabilityImage, type GeminiClient } from '../../gemini/availabilityParser';

type ParseFields = { vendorId?: number; brandId?: number; weightId?: number };

export function availabilityRoutes(db: Db, geminiClient: GeminiClient, uploadsDir: string) {
  return async function routes(api: FastifyInstance) {
    api.addHook('preHandler', requireAdmin);

    api.post('/parse', async (req, reply) => {
      const fields: ParseFields = {};
      let fileBuffer: Buffer | undefined;
      let mimeType = 'image/jpeg';

      for await (const part of req.parts()) {
        if (part.type === 'file') {
          fileBuffer = await part.toBuffer();
          mimeType = part.mimetype;
        } else if (part.fieldname === 'vendorId') {
          fields.vendorId = Number(part.value);
        } else if (part.fieldname === 'brandId') {
          fields.brandId = Number(part.value);
        } else if (part.fieldname === 'weightId') {
          fields.weightId = Number(part.value);
        }
      }

      if (!fileBuffer || !fields.vendorId || !fields.brandId || !fields.weightId) {
        reply.code(400).send({ error: 'missing image or vendorId/brandId/weightId fields' });
        return;
      }

      const entries = await parseAvailabilityImage(geminiClient, {
        imageBase64: fileBuffer.toString('base64'),
        mimeType,
      });

      await fs.mkdir(uploadsDir, { recursive: true });
      const imageRef = path.join(uploadsDir, `${crypto.randomUUID()}.jpg`);
      await fs.writeFile(imageRef, fileBuffer);

      await db
        .insert(availabilityUploads)
        .values({
          vendorId: fields.vendorId,
          brandId: fields.brandId,
          weightId: fields.weightId,
          imageRef,
          rawAiResponse: JSON.stringify(entries),
          createdAt: new Date().toISOString(),
        })
        .run();

      return { entries };
    });

    api.post<{
      Body: {
        vendorId: number;
        brandId: number;
        weightId: number;
        entries: { name: string; available: boolean }[];
      };
    }>('/confirm', async (req) => {
      return replaceAvailability(db, {
        vendorId: req.body.vendorId,
        brandId: req.body.brandId,
        weightId: req.body.weightId,
        entries: req.body.entries,
      });
    });
  };
}
```

- [ ] **Step 5: Modify `server/src/api/app.ts` to thread the new dependencies**

Add `geminiClient: GeminiClient; uploadsDir: string;` to `buildApp`'s `deps` type, add the import `import { availabilityRoutes } from './routes/availability';` and `import type { GeminiClient } from '../gemini/availabilityParser';`, and inside the `/api` plugin body add:

```typescript
      api.register(availabilityRoutes(deps.db, deps.geminiClient, deps.uploadsDir), { prefix: '/admin/availability' });
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `npm run test --workspace=@tobacconist/server -- routes/availability`
Expected: PASS (3 tests)

- [ ] **Step 7: Commit**

```bash
git add server/src/api/routes/availability.ts server/src/api/routes/availability.test.ts server/src/api/app.ts server/package.json
git commit -m "feat(server): add availability upload parse/confirm API routes"
```

---

### Task 17: API routes — purchase rounds

**Files:**
- Create: `server/src/api/routes/rounds.ts`
- Modify: `server/src/api/app.ts` (register route plugin, add a global error handler mapping thrown domain `Error`s to HTTP 400)
- Test: `server/src/api/routes/rounds.test.ts`

**Interfaces:**
- Consumes: `Db`, `schema.vendors` (Task 2); `openRound`, `closeRound`, `reopenRound`, `getActiveRound`, `getRound`, `type Round` (Task 6); `generateOrUpdateChecklist` (Task 9); `requireAdmin` (Task 14)
- Produces: `roundsRoutes(db: Db): FastifyPluginAsync`, mounted at `/api/rounds` — `GET /active`, `GET /:roundId`, `POST /` (admin), `POST /:roundId/close` (admin, also regenerates the checklist), `POST /:roundId/reopen` (admin). All return `RoundDto`.
- Consumed by: `server/src/api/app.ts`; Mini App round-control and order-builder screens (Tasks 25-27)

- [ ] **Step 1: Write the failing tests**

```typescript
// server/src/api/routes/rounds.test.ts
import { describe, it, expect } from 'vitest';
import Fastify from 'fastify';
import { createTestDb } from '../../db/client';
import { createVendor, setVendorBrandPrice } from '../../domain/vendors';
import { createBrand, getWeights } from '../../domain/catalog';
import { replaceAvailability } from '../../domain/availability';
import { upsertOrderItem } from '../../domain/orders';
import { listChecklist } from '../../domain/checklist';
import { roundsRoutes } from './rounds';
import type { AuthedUser } from '../middleware/authenticate';

const admin: AuthedUser = { id: 1, telegramId: '1', displayName: 'Admin', role: 'admin' };
const member: AuthedUser = { id: 2, telegramId: '2', displayName: 'Friend', role: 'member' };

function testApp(user: AuthedUser, db: ReturnType<typeof createTestDb>) {
  const app = Fastify();
  app.addHook('preHandler', async (req) => {
    req.authedUser = user;
  });
  app.setErrorHandler((err, req, reply) => {
    reply.code(400).send({ error: (err as Error).message });
  });
  app.register(roundsRoutes(db), { prefix: '/api/rounds' });
  return app;
}

async function seedVendorWithStock(db: ReturnType<typeof createTestDb>) {
  const vendor = await createVendor(db, 'Vasya');
  const brand = await createBrand(db, 'DarkSide');
  await setVendorBrandPrice(db, vendor.id, brand.id, 20);
  const w250 = (await getWeights(db)).find((w) => w.grams === 250)!;
  const [{ flavorId }] = await replaceAvailability(db, {
    vendorId: vendor.id,
    brandId: brand.id,
    weightId: w250.id,
    entries: [{ name: 'CyberKiwi', available: true }],
  });
  return { vendor, brand, w250, flavorId };
}

describe('rounds routes', () => {
  it('GET /active returns null when no round is open', async () => {
    const db = createTestDb();
    const app = testApp(admin, db);
    const res = await app.inject({ method: 'GET', url: '/api/rounds/active' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toBeNull();
  });

  it('POST / opens a round (admin only) and GET /active reflects it', async () => {
    const db = createTestDb();
    const { vendor } = await seedVendorWithStock(db);
    const app = testApp(admin, db);
    const create = await app.inject({ method: 'POST', url: '/api/rounds', payload: { vendorId: vendor.id } });
    expect(create.statusCode).toBe(201);
    expect(create.json()).toMatchObject({ vendorId: vendor.id, vendorName: 'Vasya', status: 'open' });

    const active = await app.inject({ method: 'GET', url: '/api/rounds/active' });
    expect(active.json().status).toBe('open');
  });

  it('rejects opening a round as a non-admin with 403', async () => {
    const db = createTestDb();
    const { vendor } = await seedVendorWithStock(db);
    const app = testApp(member, db);
    const res = await app.inject({ method: 'POST', url: '/api/rounds', payload: { vendorId: vendor.id } });
    expect(res.statusCode).toBe(403);
  });

  it('maps a domain error (opening a second round) to HTTP 400', async () => {
    const db = createTestDb();
    const { vendor } = await seedVendorWithStock(db);
    const app = testApp(admin, db);
    await app.inject({ method: 'POST', url: '/api/rounds', payload: { vendorId: vendor.id } });
    const res = await app.inject({ method: 'POST', url: '/api/rounds', payload: { vendorId: vendor.id } });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toMatch(/already open/i);
  });

  it('POST /:roundId/close regenerates the checklist from current orders', async () => {
    const db = createTestDb();
    const { vendor, brand, w250, flavorId } = await seedVendorWithStock(db);
    const app = testApp(admin, db);
    const create = await app.inject({ method: 'POST', url: '/api/rounds', payload: { vendorId: vendor.id } });
    const roundId = create.json().id;
    await upsertOrderItem(db, { roundId, userId: admin.id, brandId: brand.id, flavorId, weightId: w250.id, quantity: 4 });

    const close = await app.inject({ method: 'POST', url: `/api/rounds/${roundId}/close` });
    expect(close.statusCode).toBe(200);
    expect(close.json().status).toBe('closed');

    const checklist = await listChecklist(db, roundId);
    expect(checklist).toEqual([expect.objectContaining({ expectedQty: 4, receivedQty: 0 })]);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm run test --workspace=@tobacconist/server -- routes/rounds`
Expected: FAIL — `./rounds` route module doesn't exist

- [ ] **Step 3: Write `server/src/api/routes/rounds.ts`**

```typescript
import type { FastifyInstance } from 'fastify';
import { eq } from 'drizzle-orm';
import type { Db } from '../../db/client';
import { vendors } from '../../db/schema';
import { requireAdmin } from '../middleware/authenticate';
import { openRound, closeRound, reopenRound, getActiveRound, getRound, type Round } from '../../domain/rounds';
import { generateOrUpdateChecklist } from '../../domain/checklist';

async function toRoundDto(db: Db, round: Round) {
  const vendor = await db.select().from(vendors).where(eq(vendors.id, round.vendorId)).get();
  return {
    id: round.id,
    vendorId: round.vendorId,
    vendorName: vendor?.name ?? '',
    status: round.status,
    openedAt: round.openedAt,
    closedAt: round.closedAt,
  };
}

export function roundsRoutes(db: Db) {
  return async function routes(api: FastifyInstance) {
    api.get('/active', async () => {
      const round = await getActiveRound(db);
      return round ? toRoundDto(db, round) : null;
    });

    api.get<{ Params: { roundId: string } }>('/:roundId', async (req, reply) => {
      const round = await getRound(db, Number(req.params.roundId));
      if (!round) {
        reply.code(404).send({ error: 'round not found' });
        return;
      }
      return toRoundDto(db, round);
    });

    api.post<{ Body: { vendorId: number } }>('/', { preHandler: requireAdmin }, async (req, reply) => {
      const round = await openRound(db, req.body.vendorId, req.authedUser!.id);
      reply.code(201).send(await toRoundDto(db, round));
    });

    api.post<{ Params: { roundId: string } }>(
      '/:roundId/close',
      { preHandler: requireAdmin },
      async (req) => {
        const roundId = Number(req.params.roundId);
        await closeRound(db, roundId);
        await generateOrUpdateChecklist(db, roundId);
        return toRoundDto(db, (await getRound(db, roundId))!);
      }
    );

    api.post<{ Params: { roundId: string } }>(
      '/:roundId/reopen',
      { preHandler: requireAdmin },
      async (req) => {
        const roundId = Number(req.params.roundId);
        await reopenRound(db, roundId);
        return toRoundDto(db, (await getRound(db, roundId))!);
      }
    );
  };
}
```

- [ ] **Step 4: Modify `server/src/api/app.ts`** — register the route and add a global error handler

Add the import `import { roundsRoutes } from './routes/rounds';`, add inside the `/api` plugin body:

```typescript
      api.register(roundsRoutes(deps.db), { prefix: '/rounds' });
```

And add, right after `const app = Fastify({ logger: true });`:

```typescript
  app.setErrorHandler((err, req, reply) => {
    if (err.statusCode) {
      reply.code(err.statusCode).send({ error: err.message });
      return;
    }
    reply.code(400).send({ error: err.message });
  });
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npm run test --workspace=@tobacconist/server -- routes/rounds`
Expected: PASS (5 tests)

- [ ] **Step 6: Commit**

```bash
git add server/src/api/routes/rounds.ts server/src/api/routes/rounds.test.ts server/src/api/app.ts
git commit -m "feat(server): add purchase round API routes with checklist regeneration on close"
```

---

### Task 18: API routes — participant orders

**Files:**
- Create: `server/src/api/routes/orders.ts`
- Modify: `server/src/api/app.ts` (register route plugin)
- Test: `server/src/api/routes/orders.test.ts`

**Interfaces:**
- Consumes: `Db` (Task 2); `getActiveRound` (Task 6); `listVendorAssortment` (Task 4); `upsertOrderItem` (Task 7); `computeUserSummary` (Task 8); `AuthedUser` (Task 14)
- Produces: `ordersRoutes(db: Db): FastifyPluginAsync`, mounted at `/api/orders` — `GET /assortment` (available items for the active round's vendor, `[]` if no active round), `GET /mine` (the caller's own summary for the active round), `PUT /items` (upsert one order line for the caller against the active round)
- Consumed by: `server/src/api/app.ts`; Mini App participant order-builder screen (Task 27)

- [ ] **Step 1: Write the failing tests**

```typescript
// server/src/api/routes/orders.test.ts
import { describe, it, expect } from 'vitest';
import Fastify from 'fastify';
import { createTestDb } from '../../db/client';
import { createVendor, setVendorBrandPrice } from '../../domain/vendors';
import { createBrand, getWeights } from '../../domain/catalog';
import { replaceAvailability } from '../../domain/availability';
import { openRound } from '../../domain/rounds';
import { ordersRoutes } from './orders';
import type { AuthedUser } from '../middleware/authenticate';

const admin: AuthedUser = { id: 1, telegramId: '1', displayName: 'Admin', role: 'admin' };
const friend: AuthedUser = { id: 2, telegramId: '2', displayName: 'Friend', role: 'member' };

function testApp(user: AuthedUser, db: ReturnType<typeof createTestDb>) {
  const app = Fastify();
  app.addHook('preHandler', async (req) => {
    req.authedUser = user;
  });
  app.setErrorHandler((err, req, reply) => reply.code(400).send({ error: (err as Error).message }));
  app.register(ordersRoutes(db), { prefix: '/api/orders' });
  return app;
}

describe('orders routes', () => {
  it('GET /assortment returns [] when no round is open', async () => {
    const db = createTestDb();
    const app = testApp(friend, db);
    const res = await app.inject({ method: 'GET', url: '/api/orders/assortment' });
    expect(res.json()).toEqual([]);
  });

  it('PUT /items rejects when no round is open', async () => {
    const db = createTestDb();
    const app = testApp(friend, db);
    const res = await app.inject({
      method: 'PUT',
      url: '/api/orders/items',
      payload: { brandId: 1, flavorId: 1, weightId: 1, quantity: 1 },
    });
    expect(res.statusCode).toBe(400);
  });

  it('full flow: assortment shows the item, PUT creates it, GET /mine totals it', async () => {
    const db = createTestDb();
    const vendor = await createVendor(db, 'Vasya');
    const brand = await createBrand(db, 'DarkSide');
    await setVendorBrandPrice(db, vendor.id, brand.id, 20);
    const w250 = (await getWeights(db)).find((w) => w.grams === 250)!;
    const [{ flavorId }] = await replaceAvailability(db, {
      vendorId: vendor.id,
      brandId: brand.id,
      weightId: w250.id,
      entries: [{ name: 'CyberKiwi', available: true }],
    });
    await openRound(db, vendor.id, admin.id);

    const app = testApp(friend, db);

    const assortment = await app.inject({ method: 'GET', url: '/api/orders/assortment' });
    expect(assortment.json()).toEqual([
      expect.objectContaining({ brandName: 'DarkSide', flavorName: 'CyberKiwi', grams: 250, available: true }),
    ]);

    await app.inject({
      method: 'PUT',
      url: '/api/orders/items',
      payload: { brandId: brand.id, flavorId, weightId: w250.id, quantity: 3 },
    });

    const mine = await app.inject({ method: 'GET', url: '/api/orders/mine' });
    expect(mine.json()).toMatchObject({ totalKg: 0.75, totalEur: 15, hasUnavailableItems: false });
    expect(mine.json().items).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm run test --workspace=@tobacconist/server -- routes/orders`
Expected: FAIL — `./orders` route module doesn't exist

- [ ] **Step 3: Write `server/src/api/routes/orders.ts`**

```typescript
import type { FastifyInstance } from 'fastify';
import type { Db } from '../../db/client';
import { getActiveRound } from '../../domain/rounds';
import { listVendorAssortment } from '../../domain/availability';
import { upsertOrderItem } from '../../domain/orders';
import { computeUserSummary } from '../../domain/summary';

export function ordersRoutes(db: Db) {
  return async function routes(api: FastifyInstance) {
    api.get('/assortment', async () => {
      const round = await getActiveRound(db);
      if (!round) return [];
      return listVendorAssortment(db, round.vendorId, { onlyAvailable: true });
    });

    api.get('/mine', async (req) => {
      const round = await getActiveRound(db);
      if (!round) return { round: null, items: [], totalKg: 0, totalEur: 0, hasUnavailableItems: false };
      const summary = await computeUserSummary(db, round.id, req.authedUser!.id);
      return { round: { id: round.id, vendorId: round.vendorId, status: round.status }, ...summary };
    });

    api.put<{ Body: { brandId: number; flavorId: number; weightId: number; quantity: number } }>(
      '/items',
      async (req, reply) => {
        const round = await getActiveRound(db);
        if (!round) {
          reply.code(400).send({ error: 'no active round' });
          return;
        }
        const item = await upsertOrderItem(db, {
          roundId: round.id,
          userId: req.authedUser!.id,
          brandId: req.body.brandId,
          flavorId: req.body.flavorId,
          weightId: req.body.weightId,
          quantity: req.body.quantity,
        });
        return { item };
      }
    );
  };
}
```

- [ ] **Step 4: Modify `server/src/api/app.ts`** — register the route

Add import `import { ordersRoutes } from './routes/orders';` and, inside the `/api` plugin body:

```typescript
      api.register(ordersRoutes(deps.db), { prefix: '/orders' });
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npm run test --workspace=@tobacconist/server -- routes/orders`
Expected: PASS (3 tests)

- [ ] **Step 6: Commit**

```bash
git add server/src/api/routes/orders.ts server/src/api/routes/orders.test.ts server/src/api/app.ts
git commit -m "feat(server): add participant order API routes"
```

---

### Task 19: Telegram document sender & snapshot API routes

**Files:**
- Create: `server/src/telegram/notify.ts`
- Create: `server/src/api/routes/snapshot.ts`
- Modify: `server/src/api/app.ts` (add `documentSender` dep, register route plugin)
- Test: `server/src/api/routes/snapshot.test.ts`

**Interfaces:**
- Consumes: `computeAggregateSummary` (Task 8); `buildTextSnapshot`, `buildTableSnapshot` (Task 11); `buildSnapshotWorkbook` (Task 12); `requireAdmin` (Task 14)
- Produces:
  - `interface DocumentSender { sendDocument(chatId: string | number, buffer: Buffer, filename: string): Promise<void> }`
  - `createDocumentSender(bot: Bot): DocumentSender` (thin grammY adapter, not unit-tested directly — exercised via manual testing per Global Constraints/spec §13)
  - `snapshotRoutes(db: Db, documentSender: DocumentSender): FastifyPluginAsync`, mounted at `/api/rounds/:roundId/snapshot` — `GET /` returns `{ text, table }`, `POST /export` builds the XLSX and DMs it to the calling admin
- Consumed by: `server/src/api/app.ts`; Mini App admin snapshot screen (Task 26)

- [ ] **Step 1: Write `server/src/telegram/notify.ts`**

```typescript
import { Bot, InputFile } from 'grammy';

export interface DocumentSender {
  sendDocument(chatId: string | number, buffer: Buffer, filename: string): Promise<void>;
}

export function createDocumentSender(bot: Bot): DocumentSender {
  return {
    async sendDocument(chatId, buffer, filename) {
      await bot.api.sendDocument(chatId, new InputFile(buffer, filename));
    },
  };
}
```

- [ ] **Step 2: Write the failing tests for the snapshot routes**

```typescript
// server/src/api/routes/snapshot.test.ts
import { describe, it, expect, vi } from 'vitest';
import Fastify from 'fastify';
import { createTestDb } from '../../db/client';
import { createVendor, setVendorBrandPrice } from '../../domain/vendors';
import { createBrand, getWeights } from '../../domain/catalog';
import { replaceAvailability } from '../../domain/availability';
import { openRound } from '../../domain/rounds';
import { upsertOrderItem } from '../../domain/orders';
import { snapshotRoutes } from './snapshot';
import type { AuthedUser } from '../middleware/authenticate';
import type { DocumentSender } from '../../telegram/notify';

const admin: AuthedUser = { id: 1, telegramId: '1', displayName: 'Admin', role: 'admin' };
const member: AuthedUser = { id: 2, telegramId: '2', displayName: 'Friend', role: 'member' };

async function seedRoundWithOrder() {
  const db = createTestDb();
  const vendor = await createVendor(db, 'Vasya');
  const brand = await createBrand(db, 'DarkSide');
  await setVendorBrandPrice(db, vendor.id, brand.id, 20);
  const w250 = (await getWeights(db)).find((w) => w.grams === 250)!;
  const [{ flavorId }] = await replaceAvailability(db, {
    vendorId: vendor.id,
    brandId: brand.id,
    weightId: w250.id,
    entries: [{ name: 'CyberKiwi', available: true }],
  });
  const round = await openRound(db, vendor.id, admin.id);
  await upsertOrderItem(db, { roundId: round.id, userId: admin.id, brandId: brand.id, flavorId, weightId: w250.id, quantity: 3 });
  return { db, round };
}

function testApp(user: AuthedUser, db: ReturnType<typeof createTestDb>, documentSender: DocumentSender) {
  const app = Fastify();
  app.addHook('preHandler', async (req) => {
    req.authedUser = user;
  });
  app.register(snapshotRoutes(db, documentSender), { prefix: '/api/rounds/:roundId/snapshot' });
  return app;
}

describe('snapshot routes', () => {
  it('GET / returns text and table for the round', async () => {
    const { db, round } = await seedRoundWithOrder();
    const app = testApp(admin, db, { sendDocument: vi.fn() });
    const res = await app.inject({ method: 'GET', url: `/api/rounds/${round.id}/snapshot` });
    expect(res.statusCode).toBe(200);
    expect(res.json().text).toContain('DarkSide - CyberKiwi - 250g - x3');
    expect(res.json().table).toEqual([
      { brand: 'DarkSide', flavor: 'CyberKiwi', weight: '250g', quantity: 3, totalEur: 15 },
    ]);
  });

  it('POST /export builds an XLSX and DMs it to the calling admin', async () => {
    const { db, round } = await seedRoundWithOrder();
    const sendDocument = vi.fn().mockResolvedValue(undefined);
    const app = testApp(admin, db, { sendDocument });
    const res = await app.inject({ method: 'POST', url: `/api/rounds/${round.id}/snapshot/export` });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ sent: true });
    expect(sendDocument).toHaveBeenCalledTimes(1);
    expect(sendDocument.mock.calls[0][0]).toBe('1');
    expect(sendDocument.mock.calls[0][2]).toBe(`order-round-${round.id}.xlsx`);
  });

  it('rejects a non-admin user with 403', async () => {
    const { db, round } = await seedRoundWithOrder();
    const app = testApp(member, db, { sendDocument: vi.fn() });
    const res = await app.inject({ method: 'GET', url: `/api/rounds/${round.id}/snapshot` });
    expect(res.statusCode).toBe(403);
  });
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `npm run test --workspace=@tobacconist/server -- routes/snapshot`
Expected: FAIL — `./snapshot` route module doesn't exist

- [ ] **Step 4: Write `server/src/api/routes/snapshot.ts`**

```typescript
import type { FastifyInstance } from 'fastify';
import type { Db } from '../../db/client';
import { requireAdmin } from '../middleware/authenticate';
import { computeAggregateSummary } from '../../domain/summary';
import { buildTextSnapshot, buildTableSnapshot } from '../../domain/snapshot';
import { buildSnapshotWorkbook } from '../../domain/xlsx';
import type { DocumentSender } from '../../telegram/notify';

export function snapshotRoutes(db: Db, documentSender: DocumentSender) {
  return async function routes(api: FastifyInstance) {
    api.addHook('preHandler', requireAdmin);

    api.get<{ Params: { roundId: string } }>('/', async (req) => {
      const { lines } = await computeAggregateSummary(db, Number(req.params.roundId));
      return { text: buildTextSnapshot(lines), table: buildTableSnapshot(lines) };
    });

    api.post<{ Params: { roundId: string } }>('/export', async (req) => {
      const roundId = Number(req.params.roundId);
      const { lines } = await computeAggregateSummary(db, roundId);
      const table = buildTableSnapshot(lines);
      const buffer = await buildSnapshotWorkbook(table);
      await documentSender.sendDocument(req.authedUser!.telegramId, buffer, `order-round-${roundId}.xlsx`);
      return { sent: true };
    });
  };
}
```

- [ ] **Step 5: Modify `server/src/api/app.ts`** — thread `documentSender` and register the route

Add `documentSender: DocumentSender;` to `buildApp`'s `deps` type, the import `import { snapshotRoutes } from './routes/snapshot';` and `import type { DocumentSender } from '../telegram/notify';`, and inside the `/api` plugin body:

```typescript
      api.register(snapshotRoutes(deps.db, deps.documentSender), { prefix: '/rounds/:roundId/snapshot' });
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `npm run test --workspace=@tobacconist/server -- routes/snapshot`
Expected: PASS (3 tests)

- [ ] **Step 7: Commit**

```bash
git add server/src/telegram/notify.ts server/src/api/routes/snapshot.ts server/src/api/routes/snapshot.test.ts server/src/api/app.ts
git commit -m "feat(server): add snapshot text/table/export API routes and document sender"
```

---

### Task 20: API routes — delivery checklist

**Files:**
- Create: `server/src/api/routes/checklist.ts`
- Modify: `server/src/api/app.ts` (register route plugin)
- Test: `server/src/api/routes/checklist.test.ts`

**Interfaces:**
- Consumes: `Db`, `schema.{brands,flavors,weights}` (Task 2); `listChecklist`, `adjustReceivedQty` (Task 9); `requireAdmin` (Task 14)
- Produces: `checklistRoutes(db: Db): FastifyPluginAsync`, mounted at `/api/rounds/:roundId/checklist` (admin only) — `GET /` returns `ChecklistItemDto[]`, `POST /:itemId/adjust` with body `{ delta: number }` applies `+`/`-` and returns the updated item
- Consumed by: `server/src/api/app.ts`; Mini App admin checklist screen (Task 26)

- [ ] **Step 1: Write the failing tests**

```typescript
// server/src/api/routes/checklist.test.ts
import { describe, it, expect } from 'vitest';
import Fastify from 'fastify';
import { createTestDb } from '../../db/client';
import { createVendor, setVendorBrandPrice } from '../../domain/vendors';
import { createBrand, getWeights } from '../../domain/catalog';
import { replaceAvailability } from '../../domain/availability';
import { openRound } from '../../domain/rounds';
import { upsertOrderItem } from '../../domain/orders';
import { generateOrUpdateChecklist } from '../../domain/checklist';
import { checklistRoutes } from './checklist';
import type { AuthedUser } from '../middleware/authenticate';

const admin: AuthedUser = { id: 1, telegramId: '1', displayName: 'Admin', role: 'admin' };

function testApp(user: AuthedUser, db: ReturnType<typeof createTestDb>) {
  const app = Fastify();
  app.addHook('preHandler', async (req) => {
    req.authedUser = user;
  });
  app.register(checklistRoutes(db), { prefix: '/api/rounds/:roundId/checklist' });
  return app;
}

async function seedClosedRoundChecklist() {
  const db = createTestDb();
  const vendor = await createVendor(db, 'Vasya');
  const brand = await createBrand(db, 'DarkSide');
  await setVendorBrandPrice(db, vendor.id, brand.id, 20);
  const w250 = (await getWeights(db)).find((w) => w.grams === 250)!;
  const [{ flavorId }] = await replaceAvailability(db, {
    vendorId: vendor.id,
    brandId: brand.id,
    weightId: w250.id,
    entries: [{ name: 'CyberKiwi', available: true }],
  });
  const round = await openRound(db, vendor.id, admin.id);
  await upsertOrderItem(db, { roundId: round.id, userId: admin.id, brandId: brand.id, flavorId, weightId: w250.id, quantity: 5 });
  await generateOrUpdateChecklist(db, round.id);
  return { db, round };
}

describe('checklist routes', () => {
  it('GET / returns checklist rows with resolved names', async () => {
    const { db, round } = await seedClosedRoundChecklist();
    const app = testApp(admin, db);
    const res = await app.inject({ method: 'GET', url: `/api/rounds/${round.id}/checklist` });
    expect(res.json()).toEqual([
      expect.objectContaining({ brandName: 'DarkSide', flavorName: 'CyberKiwi', grams: 250, expectedQty: 5, receivedQty: 0 }),
    ]);
  });

  it('POST /:itemId/adjust bumps receivedQty by delta', async () => {
    const { db, round } = await seedClosedRoundChecklist();
    const app = testApp(admin, db);
    const list = await app.inject({ method: 'GET', url: `/api/rounds/${round.id}/checklist` });
    const itemId = list.json()[0].id;
    const res = await app.inject({
      method: 'POST',
      url: `/api/rounds/${round.id}/checklist/${itemId}/adjust`,
      payload: { delta: 2 },
    });
    expect(res.json().receivedQty).toBe(2);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm run test --workspace=@tobacconist/server -- routes/checklist`
Expected: FAIL — `./checklist` route module doesn't exist

- [ ] **Step 3: Write `server/src/api/routes/checklist.ts`**

```typescript
import type { FastifyInstance } from 'fastify';
import { eq } from 'drizzle-orm';
import type { Db } from '../../db/client';
import { brands, flavors, weights } from '../../db/schema';
import { requireAdmin } from '../middleware/authenticate';
import { listChecklist, adjustReceivedQty, type ChecklistRow } from '../../domain/checklist';

async function toChecklistDto(db: Db, row: ChecklistRow) {
  const [brand, flavor, weight] = await Promise.all([
    db.select().from(brands).where(eq(brands.id, row.brandId)).get(),
    db.select().from(flavors).where(eq(flavors.id, row.flavorId)).get(),
    db.select().from(weights).where(eq(weights.id, row.weightId)).get(),
  ]);
  return {
    id: row.id,
    brandId: row.brandId,
    brandName: brand?.name ?? '',
    flavorId: row.flavorId,
    flavorName: flavor?.name ?? '',
    weightId: row.weightId,
    grams: weight?.grams ?? 0,
    expectedQty: row.expectedQty,
    receivedQty: row.receivedQty,
  };
}

export function checklistRoutes(db: Db) {
  return async function routes(api: FastifyInstance) {
    api.addHook('preHandler', requireAdmin);

    api.get<{ Params: { roundId: string } }>('/', async (req) => {
      const rows = await listChecklist(db, Number(req.params.roundId));
      return Promise.all(rows.map((row) => toChecklistDto(db, row)));
    });

    api.post<{ Params: { roundId: string; itemId: string }; Body: { delta: number } }>(
      '/:itemId/adjust',
      async (req) => {
        const row = await adjustReceivedQty(db, Number(req.params.itemId), req.body.delta);
        return toChecklistDto(db, row);
      }
    );
  };
}
```

- [ ] **Step 4: Modify `server/src/api/app.ts`** — register the route

Add import `import { checklistRoutes } from './routes/checklist';` and, inside the `/api` plugin body:

```typescript
      api.register(checklistRoutes(deps.db), { prefix: '/rounds/:roundId/checklist' });
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npm run test --workspace=@tobacconist/server -- routes/checklist`
Expected: PASS (2 tests)

- [ ] **Step 6: Commit**

```bash
git add server/src/api/routes/checklist.ts server/src/api/routes/checklist.test.ts server/src/api/app.ts
git commit -m "feat(server): add delivery checklist API routes"
```

---

### Task 21: API routes — payments & history

**Files:**
- Create: `server/src/api/routes/payments.ts`
- Create: `server/src/api/routes/history.ts`
- Modify: `server/src/api/routes/rounds.ts` (export `toRoundDto` so `history.ts` can reuse it)
- Modify: `server/src/api/app.ts` (register both route plugins)
- Test: `server/src/api/routes/payments.test.ts`
- Test: `server/src/api/routes/history.test.ts`

**Interfaces:**
- Consumes: `Db`, `schema.{purchaseRounds,orderItems,users}` (Task 2); `listRoundOrderItems` (Task 7); `computeUserSummary` (Task 8); `getRound`, `toRoundDto` (Task 6 / Task 17); `setPaymentStatus`, `getPaymentStatus` (Task 10); `requireAdmin` (Task 14)
- Produces:
  - `paymentsRoutes(db: Db): FastifyPluginAsync`, mounted at `/api/rounds/:roundId/payments` (admin only) — `GET /` lists every user who has order items in the round with resolved `paid` status, `POST /:userId` sets it
  - `historyRoutes(db: Db): FastifyPluginAsync`, mounted at `/api/history` — `GET /` lists closed rounds (admin sees all, members see only rounds they ordered in), `GET /:roundId` returns the caller's own summary + paid status for that round
- Consumed by: `server/src/api/app.ts`; Mini App admin payments screen (Task 26) and history screen (Task 27)

- [ ] **Step 1: Modify `server/src/api/routes/rounds.ts`** — export the DTO helper

Change `async function toRoundDto` to `export async function toRoundDto`.

- [ ] **Step 2: Write the failing tests**

```typescript
// server/src/api/routes/payments.test.ts
import { describe, it, expect } from 'vitest';
import Fastify from 'fastify';
import { createTestDb } from '../../db/client';
import { createVendor, setVendorBrandPrice } from '../../domain/vendors';
import { createBrand, getWeights } from '../../domain/catalog';
import { replaceAvailability } from '../../domain/availability';
import { openRound } from '../../domain/rounds';
import { upsertOrderItem } from '../../domain/orders';
import { users } from '../../db/schema';
import { paymentsRoutes } from './payments';
import type { AuthedUser } from '../middleware/authenticate';

const admin: AuthedUser = { id: 1, telegramId: '1', displayName: 'Admin', role: 'admin' };

function testApp(db: ReturnType<typeof createTestDb>) {
  const app = Fastify();
  app.addHook('preHandler', async (req) => {
    req.authedUser = admin;
  });
  app.register(paymentsRoutes(db), { prefix: '/api/rounds/:roundId/payments' });
  return app;
}

describe('payments routes', () => {
  it('GET / lists participants with default unpaid, POST /:userId marks paid', async () => {
    const db = createTestDb();
    await db.insert(users).values({ id: 1, telegramId: '1', displayName: 'Admin', role: 'admin', firstSeenAt: new Date().toISOString() }).run();
    const [friend] = await db.insert(users).values({ telegramId: '2', displayName: 'Friend', role: 'member', firstSeenAt: new Date().toISOString() }).returning().all();
    const vendor = await createVendor(db, 'Vasya');
    const brand = await createBrand(db, 'DarkSide');
    await setVendorBrandPrice(db, vendor.id, brand.id, 20);
    const w250 = (await getWeights(db)).find((w) => w.grams === 250)!;
    const [{ flavorId }] = await replaceAvailability(db, { vendorId: vendor.id, brandId: brand.id, weightId: w250.id, entries: [{ name: 'CyberKiwi', available: true }] });
    const round = await openRound(db, vendor.id, admin.id);
    await upsertOrderItem(db, { roundId: round.id, userId: friend.id, brandId: brand.id, flavorId, weightId: w250.id, quantity: 1 });

    const app = testApp(db);
    const list = await app.inject({ method: 'GET', url: `/api/rounds/${round.id}/payments` });
    expect(list.json()).toEqual([{ userId: friend.id, displayName: 'Friend', paid: false }]);

    await app.inject({ method: 'POST', url: `/api/rounds/${round.id}/payments/${friend.id}`, payload: { paid: true } });
    const after = await app.inject({ method: 'GET', url: `/api/rounds/${round.id}/payments` });
    expect(after.json()).toEqual([{ userId: friend.id, displayName: 'Friend', paid: true }]);
  });
});
```

```typescript
// server/src/api/routes/history.test.ts
import { describe, it, expect } from 'vitest';
import Fastify from 'fastify';
import { createTestDb } from '../../db/client';
import { createVendor, setVendorBrandPrice } from '../../domain/vendors';
import { createBrand, getWeights } from '../../domain/catalog';
import { replaceAvailability } from '../../domain/availability';
import { openRound, closeRound } from '../../domain/rounds';
import { upsertOrderItem } from '../../domain/orders';
import { historyRoutes } from './history';
import type { AuthedUser } from '../middleware/authenticate';

const admin: AuthedUser = { id: 1, telegramId: '1', displayName: 'Admin', role: 'admin' };
const friend: AuthedUser = { id: 2, telegramId: '2', displayName: 'Friend', role: 'member' };
const bystander: AuthedUser = { id: 3, telegramId: '3', displayName: 'Bystander', role: 'member' };

function testApp(user: AuthedUser, db: ReturnType<typeof createTestDb>) {
  const app = Fastify();
  app.addHook('preHandler', async (req) => {
    req.authedUser = user;
  });
  app.register(historyRoutes(db), { prefix: '/api/history' });
  return app;
}

async function seedClosedRoundWithFriendOrder() {
  const db = createTestDb();
  const vendor = await createVendor(db, 'Vasya');
  const brand = await createBrand(db, 'DarkSide');
  await setVendorBrandPrice(db, vendor.id, brand.id, 20);
  const w250 = (await getWeights(db)).find((w) => w.grams === 250)!;
  const [{ flavorId }] = await replaceAvailability(db, { vendorId: vendor.id, brandId: brand.id, weightId: w250.id, entries: [{ name: 'CyberKiwi', available: true }] });
  const round = await openRound(db, vendor.id, admin.id);
  await upsertOrderItem(db, { roundId: round.id, userId: friend.id, brandId: brand.id, flavorId, weightId: w250.id, quantity: 2 });
  await closeRound(db, round.id);
  return { db, round };
}

describe('history routes', () => {
  it('a member who did not order in the round does not see it in GET /', async () => {
    const { db, round } = await seedClosedRoundWithFriendOrder();
    const app = testApp(bystander, db);
    const res = await app.inject({ method: 'GET', url: '/api/history' });
    expect(res.json()).toEqual([]);
  });

  it('the member who ordered sees it, and admin sees all closed rounds', async () => {
    const { db, round } = await seedClosedRoundWithFriendOrder();
    const friendRes = await testApp(friend, db).inject({ method: 'GET', url: '/api/history' });
    expect(friendRes.json()).toHaveLength(1);
    const adminRes = await testApp(admin, db).inject({ method: 'GET', url: '/api/history' });
    expect(adminRes.json()).toHaveLength(1);
  });

  it('GET /:roundId returns the caller own summary for that round', async () => {
    const { db, round } = await seedClosedRoundWithFriendOrder();
    const app = testApp(friend, db);
    const res = await app.inject({ method: 'GET', url: `/api/history/${round.id}` });
    expect(res.json()).toMatchObject({ totalKg: 0.5, totalEur: 10, paid: false });
  });
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `npm run test --workspace=@tobacconist/server -- routes/payments routes/history`
Expected: FAIL — `./payments` and `./history` route modules don't exist

- [ ] **Step 4: Write `server/src/api/routes/payments.ts`**

```typescript
import type { FastifyInstance } from 'fastify';
import { eq } from 'drizzle-orm';
import type { Db } from '../../db/client';
import { users } from '../../db/schema';
import { requireAdmin } from '../middleware/authenticate';
import { listRoundOrderItems } from '../../domain/orders';
import { setPaymentStatus, getPaymentStatus } from '../../domain/payments';

export function paymentsRoutes(db: Db) {
  return async function routes(api: FastifyInstance) {
    api.addHook('preHandler', requireAdmin);

    api.get<{ Params: { roundId: string } }>('/', async (req) => {
      const roundId = Number(req.params.roundId);
      const items = await listRoundOrderItems(db, roundId);
      const userIds = [...new Set(items.map((i) => i.userId))];
      const result = [];
      for (const userId of userIds) {
        const user = await db.select().from(users).where(eq(users.id, userId)).get();
        const paid = await getPaymentStatus(db, roundId, userId);
        result.push({ userId, displayName: user?.displayName ?? '', paid });
      }
      return result;
    });

    api.post<{ Params: { roundId: string; userId: string }; Body: { paid: boolean } }>(
      '/:userId',
      async (req) => {
        const roundId = Number(req.params.roundId);
        const userId = Number(req.params.userId);
        return setPaymentStatus(db, roundId, userId, req.body.paid, req.authedUser!.id);
      }
    );
  };
}
```

- [ ] **Step 5: Write `server/src/api/routes/history.ts`**

```typescript
import type { FastifyInstance } from 'fastify';
import { eq } from 'drizzle-orm';
import type { Db } from '../../db/client';
import { purchaseRounds, orderItems } from '../../db/schema';
import { getRound } from '../../domain/rounds';
import { computeUserSummary } from '../../domain/summary';
import { getPaymentStatus } from '../../domain/payments';
import { toRoundDto } from './rounds';

export function historyRoutes(db: Db) {
  return async function routes(api: FastifyInstance) {
    api.get('/', async (req) => {
      const rows = await db.select().from(purchaseRounds).where(eq(purchaseRounds.status, 'closed')).all();
      const dtos = await Promise.all(rows.map((r) => toRoundDto(db, r)));
      if (req.authedUser!.role === 'admin') return dtos;
      const myItems = await db
        .select()
        .from(orderItems)
        .where(eq(orderItems.userId, req.authedUser!.id))
        .all();
      const myRoundIds = new Set(myItems.map((i) => i.roundId));
      return dtos.filter((d) => myRoundIds.has(d.id));
    });

    api.get<{ Params: { roundId: string } }>('/:roundId', async (req) => {
      const roundId = Number(req.params.roundId);
      const round = await getRound(db, roundId);
      if (!round) throw new Error('round not found');
      const summary = await computeUserSummary(db, roundId, req.authedUser!.id);
      const paid = await getPaymentStatus(db, roundId, req.authedUser!.id);
      return { round: await toRoundDto(db, round), ...summary, paid };
    });
  };
}
```

- [ ] **Step 6: Modify `server/src/api/app.ts`** — register both routes

Add imports `import { paymentsRoutes } from './routes/payments';` and `import { historyRoutes } from './routes/history';`, and inside the `/api` plugin body:

```typescript
      api.register(paymentsRoutes(deps.db), { prefix: '/rounds/:roundId/payments' });
      api.register(historyRoutes(deps.db), { prefix: '/history' });
```

- [ ] **Step 7: Run tests to verify they pass**

Run: `npm run test --workspace=@tobacconist/server -- routes/payments routes/history`
Expected: PASS (4 tests)

- [ ] **Step 8: Commit**

```bash
git add server/src/api/routes/payments.ts server/src/api/routes/history.ts server/src/api/routes/payments.test.ts server/src/api/routes/history.test.ts server/src/api/routes/rounds.ts server/src/api/app.ts
git commit -m "feat(server): add payments and history API routes"
```

---

### Task 22: Telegram bot — `/start_round` command and vendor picker

**Files:**
- Create: `server/src/telegram/bot.ts`
- Test: `server/src/telegram/bot.test.ts`

**Note:** The command/callback handlers are written as plain functions taking a minimal duck-typed context (`reply`, `editMessageText`, `answerCallbackQuery`, `api.sendMessage`), separate from `createBot`'s grammY wiring. This keeps the business logic (permission checks, vendor listing, round opening) unit-testable without needing to fake Telegram's HTTP responses.

**Interfaces:**
- Consumes: `Db`, `schema.users` (Task 2); `listVendors` (Task 3); `openRound` (Task 6)
- Produces:
  - `handleStartRoundCommand(ctx: StartRoundCtx, deps: { db: Db; adminTelegramId: string; groupChatId: string }): Promise<void>`
  - `handleStartRoundCallback(ctx: StartRoundCallbackCtx, deps: { db: Db; adminTelegramId: string; groupChatId: string; miniAppUrl: string }): Promise<Round | undefined>`
  - `createBot(deps: { botToken: string; db: Db; adminTelegramId: string; groupChatId: string; miniAppUrl: string }): Bot`
  - Consumed by: Task 23 (server entrypoint registers the bot's webhook handler on the Fastify app)

- [ ] **Step 1: Write the failing tests**

```typescript
// server/src/telegram/bot.test.ts
import { describe, it, expect, vi } from 'vitest';
import { createTestDb } from '../db/client';
import { createVendor } from '../domain/vendors';
import { getActiveRound } from '../domain/rounds';
import { handleStartRoundCommand, handleStartRoundCallback } from './bot';

const ADMIN_ID = '555';
const GROUP_ID = '-1001';
const MINI_APP_URL = 'https://example.com/app';

function fakeCommandCtx(fromId: number | undefined, chatId: string | number | undefined) {
  return {
    from: fromId !== undefined ? { id: fromId } : undefined,
    chat: chatId !== undefined ? { id: chatId } : undefined,
    reply: vi.fn().mockResolvedValue(undefined),
  };
}

describe('handleStartRoundCommand', () => {
  it('does nothing when the sender is not the admin', async () => {
    const db = createTestDb();
    const ctx = fakeCommandCtx(999, GROUP_ID);
    await handleStartRoundCommand(ctx, { db, adminTelegramId: ADMIN_ID, groupChatId: GROUP_ID });
    expect(ctx.reply).not.toHaveBeenCalled();
  });

  it('does nothing when the message is outside the configured group', async () => {
    const db = createTestDb();
    const ctx = fakeCommandCtx(555, '-999');
    await handleStartRoundCommand(ctx, { db, adminTelegramId: ADMIN_ID, groupChatId: GROUP_ID });
    expect(ctx.reply).not.toHaveBeenCalled();
  });

  it('replies with an inline keyboard of vendors for the admin in the group', async () => {
    const db = createTestDb();
    await createVendor(db, 'Vasya');
    await createVendor(db, 'Petya');
    const ctx = fakeCommandCtx(555, GROUP_ID);
    await handleStartRoundCommand(ctx, { db, adminTelegramId: ADMIN_ID, groupChatId: GROUP_ID });
    expect(ctx.reply).toHaveBeenCalledTimes(1);
    const [, opts] = ctx.reply.mock.calls[0];
    expect(opts.reply_markup.inline_keyboard).toEqual([
      [{ text: 'Vasya', callback_data: 'start_round:1' }],
      [{ text: 'Petya', callback_data: 'start_round:2' }],
    ]);
  });
});

function fakeCallbackCtx(fromId: number | undefined, data: string | undefined) {
  return {
    from: fromId !== undefined ? { id: fromId } : undefined,
    callbackQuery: { data },
    answerCallbackQuery: vi.fn().mockResolvedValue(undefined),
    editMessageText: vi.fn().mockResolvedValue(undefined),
    api: { sendMessage: vi.fn().mockResolvedValue(undefined) },
  };
}

describe('handleStartRoundCallback', () => {
  it('acknowledges the callback but opens nothing for a non-admin sender', async () => {
    const db = createTestDb();
    const vendor = await createVendor(db, 'Vasya');
    const ctx = fakeCallbackCtx(999, `start_round:${vendor.id}`);
    await handleStartRoundCallback(ctx, { db, adminTelegramId: ADMIN_ID, groupChatId: GROUP_ID, miniAppUrl: MINI_APP_URL });
    expect(ctx.answerCallbackQuery).toHaveBeenCalledTimes(1);
    expect(await getActiveRound(db)).toBeNull();
  });

  it('opens the round, edits the picker message, and announces with a web_app button', async () => {
    const db = createTestDb();
    const vendor = await createVendor(db, 'Vasya');
    const ctx = fakeCallbackCtx(555, `start_round:${vendor.id}`);
    const round = await handleStartRoundCallback(ctx, {
      db,
      adminTelegramId: ADMIN_ID,
      groupChatId: GROUP_ID,
      miniAppUrl: MINI_APP_URL,
    });
    expect(round?.vendorId).toBe(vendor.id);
    expect(ctx.editMessageText).toHaveBeenCalledTimes(1);
    expect(ctx.api.sendMessage).toHaveBeenCalledTimes(1);
    const [chatId, , opts] = ctx.api.sendMessage.mock.calls[0];
    expect(chatId).toBe(GROUP_ID);
    expect(opts.reply_markup.inline_keyboard[0][0]).toEqual({
      text: '🛍 Заказать',
      web_app: { url: MINI_APP_URL },
    });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm run test --workspace=@tobacconist/server -- telegram/bot`
Expected: FAIL — `./bot` module doesn't exist

- [ ] **Step 3: Write `server/src/telegram/bot.ts`**

```typescript
import { Bot } from 'grammy';
import { eq } from 'drizzle-orm';
import type { Db } from '../db/client';
import { users } from '../db/schema';
import { listVendors } from '../domain/vendors';
import { openRound, type Round } from '../domain/rounds';

export interface StartRoundCtx {
  from?: { id: number };
  chat?: { id: number | string };
  reply(text: string, opts?: unknown): Promise<unknown>;
}

export async function handleStartRoundCommand(
  ctx: StartRoundCtx,
  deps: { db: Db; adminTelegramId: string; groupChatId: string }
) {
  if (!ctx.from || String(ctx.from.id) !== deps.adminTelegramId) return;
  if (!ctx.chat || String(ctx.chat.id) !== deps.groupChatId) return;

  const vendors = await listVendors(deps.db);
  if (vendors.length === 0) {
    await ctx.reply('Нет ни одного барыги. Сначала добавь через мини-апп.');
    return;
  }

  await ctx.reply('Выбери барыгу:', {
    reply_markup: {
      inline_keyboard: vendors.map((v) => [{ text: v.name, callback_data: `start_round:${v.id}` }]),
    },
  });
}

export interface StartRoundCallbackCtx {
  from?: { id: number };
  callbackQuery?: { data?: string };
  answerCallbackQuery(): Promise<unknown>;
  editMessageText(text: string): Promise<unknown>;
  api: { sendMessage(chatId: string | number, text: string, opts?: unknown): Promise<unknown> };
}

async function ensureAdminUser(db: Db, adminTelegramId: string) {
  const existing = await db.select().from(users).where(eq(users.telegramId, adminTelegramId)).get();
  if (existing) return existing;
  const [row] = await db
    .insert(users)
    .values({ telegramId: adminTelegramId, displayName: 'Admin', role: 'admin', firstSeenAt: new Date().toISOString() })
    .returning()
    .all();
  return row;
}

export async function handleStartRoundCallback(
  ctx: StartRoundCallbackCtx,
  deps: { db: Db; adminTelegramId: string; groupChatId: string; miniAppUrl: string }
): Promise<Round | undefined> {
  await ctx.answerCallbackQuery();

  if (!ctx.from || String(ctx.from.id) !== deps.adminTelegramId) return undefined;
  const match = ctx.callbackQuery?.data?.match(/^start_round:(\d+)$/);
  if (!match) return undefined;

  const vendorId = Number(match[1]);
  const adminUser = await ensureAdminUser(deps.db, deps.adminTelegramId);
  const round = await openRound(deps.db, vendorId, adminUser.id);

  await ctx.editMessageText('Раунд начат ✅');
  await ctx.api.sendMessage(deps.groupChatId, '🛍 Заказ открыт! Жми, чтобы сформировать свой заказ:', {
    reply_markup: {
      inline_keyboard: [[{ text: '🛍 Заказать', web_app: { url: deps.miniAppUrl } }]],
    },
  });

  return round;
}

export function createBot(deps: {
  botToken: string;
  db: Db;
  adminTelegramId: string;
  groupChatId: string;
  miniAppUrl: string;
}): Bot {
  const bot = new Bot(deps.botToken);
  bot.command('start_round', (ctx) => handleStartRoundCommand(ctx as unknown as StartRoundCtx, deps));
  bot.callbackQuery(/^start_round:\d+$/, (ctx) =>
    handleStartRoundCallback(ctx as unknown as StartRoundCallbackCtx, deps)
  );
  return bot;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm run test --workspace=@tobacconist/server -- telegram/bot`
Expected: PASS (5 tests)

- [ ] **Step 5: Commit**

```bash
git add server/src/telegram/bot.ts server/src/telegram/bot.test.ts
git commit -m "feat(server): add /start_round bot command with vendor picker and round announcement"
```

---

### Task 23: Server entrypoint — wire db, bot, Gemini, and the API app together

**Files:**
- Create: `server/src/index.ts`
- Test: `server/src/index.test.ts`

**Interfaces:**
- Consumes: `loadConfig`, `Config` (Task 14); `createDb` (Task 2); `createGeminiClient` (Task 5); `createBot` (Task 22); `createDocumentSender` (Task 19); `buildApp` (Task 14, extended by Tasks 15-21)
- Produces:
  - `createServer(config: Config): { app: FastifyInstance; bot: Bot; db: Db }` — pure wiring, no network calls, used by tests and by `main()`
  - `main(): Promise<void>` — reads config from `process.env`, registers the Telegram webhook with Telegram, and starts listening; only invoked when this file is run directly

- [ ] **Step 1: Write the failing test**

```typescript
// server/src/index.test.ts
import { describe, it, expect } from 'vitest';
import { createServer } from './index';
import type { Config } from './config';

const config: Config = {
  botToken: '123456:TEST-TOKEN',
  adminTelegramId: '1',
  groupChatId: '-1001',
  geminiApiKey: 'fake-key',
  dbPath: ':memory:',
  port: 0,
  publicUrl: 'https://example.com',
};

describe('createServer', () => {
  it('wires the app together and serves the health check without hitting the network', async () => {
    const { app } = createServer(config);
    const res = await app.inject({ method: 'GET', url: '/api/health' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ status: 'ok' });
  });

  it('registers a POST /telegram/webhook route for the bot', async () => {
    const { app } = createServer(config);
    const res = await app.inject({ method: 'POST', url: '/telegram/webhook', payload: {} });
    expect(res.statusCode).not.toBe(404);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test --workspace=@tobacconist/server -- index`
Expected: FAIL — `./index` module doesn't exist (or has no `createServer` export)

- [ ] **Step 3: Write `server/src/index.ts`**

```typescript
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { webhookCallback } from 'grammy';
import { loadConfig, type Config } from './config';
import { createDb } from './db/client';
import { createGeminiClient } from './gemini/client';
import { createBot } from './telegram/bot';
import { createDocumentSender } from './telegram/notify';
import { buildApp } from './api/app';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export function createServer(config: Config) {
  const db = createDb(config.dbPath);
  const geminiClient = createGeminiClient(config.geminiApiKey);
  const bot = createBot({
    botToken: config.botToken,
    db,
    adminTelegramId: config.adminTelegramId,
    groupChatId: config.groupChatId,
    miniAppUrl: config.publicUrl,
  });
  const documentSender = createDocumentSender(bot);

  const app = buildApp({
    db,
    botToken: config.botToken,
    groupChatId: config.groupChatId,
    adminTelegramId: config.adminTelegramId,
    chatMemberApi: bot.api,
    geminiClient,
    uploadsDir: path.join(path.dirname(config.dbPath === ':memory:' ? '.' : config.dbPath), 'uploads'),
    documentSender,
    miniAppDistPath: path.resolve(__dirname, '../../mini-app/dist'),
  });

  app.post('/telegram/webhook', webhookCallback(bot, 'fastify'));

  return { app, bot, db };
}

export async function main() {
  const config = loadConfig();
  const { app, bot } = createServer(config);
  await bot.api.setWebhook(`${config.publicUrl}/telegram/webhook`);
  await app.listen({ port: config.port, host: '0.0.0.0' });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test --workspace=@tobacconist/server -- index`
Expected: PASS (2 tests)

- [ ] **Step 5: Commit**

```bash
git add server/src/index.ts server/src/index.test.ts
git commit -m "feat(server): add server entrypoint wiring db, bot, Gemini, and the API app"
```

---

### Task 24: Mini App scaffold — Telegram SDK, typed API client, and app shell

**Files:**
- Create: `mini-app/package.json`, `mini-app/vite.config.ts`, `mini-app/tsconfig.json`, `mini-app/index.html`
- Create: `mini-app/src/main.tsx`, `mini-app/src/telegram.ts`, `mini-app/src/apiClient.ts`, `mini-app/src/types.ts`, `mini-app/src/App.tsx`
- Modify: `server/src/api/app.ts` (add `GET /api/me`, returning the caller's `AuthedUser`)
- Test: `mini-app/src/telegram.test.ts`, `mini-app/src/apiClient.test.ts`, `mini-app/src/App.test.tsx`

**Interfaces:**
- Consumes: nothing from server domain code directly; talks to the REST API over HTTP
- Produces:
  - `getInitData(): string` — throws if `window.Telegram.WebApp` isn't present
  - `api.get<T>(path)`, `api.post<T>(path, body)`, `api.put<T>(path, body)`, `uploadAvailabilityImage(vendorId, brandId, weightId, file): Promise<{ entries: { name: string; available: boolean }[] }>`
  - `type Me = { id: number; telegramId: string; displayName: string; role: 'admin' | 'member' }`
  - `App` component — fetches `/api/me` and renders either the admin shell or the participant shell (extended by Tasks 25-27)
  - Consumed by: Tasks 25-27 (all Mini App screens import `api`/`uploadAvailabilityImage` and render inside `App`)

- [ ] **Step 1: Modify `server/src/api/app.ts`** — add the `/api/me` route

Inside the `/api` plugin body, add:

```typescript
      api.get('/me', async (req) => req.authedUser);
```

- [ ] **Step 2: Create `mini-app/package.json`**

```json
{
  "name": "@tobacconist/mini-app",
  "version": "0.0.1",
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "tsc -b && vite build",
    "test": "vitest run"
  },
  "dependencies": {
    "react": "^18.3.0",
    "react-dom": "^18.3.0"
  },
  "devDependencies": {
    "@types/react": "^18.3.0",
    "@types/react-dom": "^18.3.0",
    "@vitejs/plugin-react": "^4.3.0",
    "typescript": "^5.5.0",
    "vite": "^5.4.0",
    "vitest": "^2.0.0",
    "jsdom": "^25.0.0",
    "@testing-library/react": "^16.0.0",
    "@testing-library/jest-dom": "^6.5.0"
  }
}
```

- [ ] **Step 3: Create `mini-app/vite.config.ts`, `mini-app/tsconfig.json`, `mini-app/index.html`**

`mini-app/vite.config.ts`:
```typescript
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  test: { environment: 'jsdom', globals: true, setupFiles: ['./src/setupTests.ts'] },
  server: {
    proxy: { '/api': 'http://localhost:3000' },
  },
});
```

`mini-app/tsconfig.json`:
```json
{
  "extends": "../tsconfig.base.json",
  "include": ["src"],
  "compilerOptions": { "jsx": "react-jsx", "lib": ["ES2022", "DOM"], "types": ["vitest/globals"] }
}
```

`mini-app/index.html`:
```html
<!doctype html>
<html lang="ru">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Tobacconist</title>
    <script src="https://telegram.org/js/telegram-web-app.js"></script>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
```

`mini-app/src/setupTests.ts`:
```typescript
import '@testing-library/jest-dom/vitest';
```

- [ ] **Step 4: Write the failing tests for `telegram.ts`**

```typescript
// mini-app/src/telegram.test.ts
import { describe, it, expect, afterEach, vi } from 'vitest';
import { getInitData } from './telegram';

describe('getInitData', () => {
  afterEach(() => {
    delete (window as any).Telegram;
  });

  it('throws when the Telegram WebApp SDK is not present', () => {
    expect(() => getInitData()).toThrow(/Telegram WebApp SDK/);
  });

  it('returns initData and calls ready/expand when the SDK is present', () => {
    const ready = vi.fn();
    const expand = vi.fn();
    (window as any).Telegram = { WebApp: { initData: 'abc123', ready, expand } };
    expect(getInitData()).toBe('abc123');
    expect(ready).toHaveBeenCalled();
    expect(expand).toHaveBeenCalled();
  });
});
```

- [ ] **Step 5: Run test to verify it fails**

Run: `npm run test --workspace=@tobacconist/mini-app -- telegram`
Expected: FAIL — `./telegram` module doesn't exist

- [ ] **Step 6: Write `mini-app/src/telegram.ts`**

```typescript
interface TelegramWebApp {
  initData: string;
  ready(): void;
  expand(): void;
}

function getTelegramWebApp(): TelegramWebApp {
  const webApp = (window as unknown as { Telegram?: { WebApp?: TelegramWebApp } }).Telegram?.WebApp;
  if (!webApp) {
    throw new Error('Telegram WebApp SDK not available — open this page inside Telegram');
  }
  webApp.ready();
  webApp.expand();
  return webApp;
}

export function getInitData(): string {
  return getTelegramWebApp().initData;
}
```

- [ ] **Step 7: Run test to verify it passes**

Run: `npm run test --workspace=@tobacconist/mini-app -- telegram`
Expected: PASS (2 tests)

- [ ] **Step 8: Write the failing tests for `apiClient.ts`**

```typescript
// mini-app/src/apiClient.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('./telegram', () => ({ getInitData: () => 'fake-init-data' }));

import { api } from './apiClient';

describe('api client', () => {
  beforeEach(() => {
    global.fetch = vi.fn();
  });

  it('sends the init data header and parses JSON on success', async () => {
    (global.fetch as any).mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ hello: 'world' }),
    });
    const result = await api.get('/foo');
    expect(result).toEqual({ hello: 'world' });
    const [, opts] = (global.fetch as any).mock.calls[0];
    expect(opts.headers['X-Telegram-Init-Data']).toBe('fake-init-data');
  });

  it('throws with the server error message on failure', async () => {
    (global.fetch as any).mockResolvedValue({
      ok: false,
      status: 400,
      json: async () => ({ error: 'bad request' }),
    });
    await expect(api.get('/foo')).rejects.toThrow('bad request');
  });
});
```

- [ ] **Step 9: Run test to verify it fails**

Run: `npm run test --workspace=@tobacconist/mini-app -- apiClient`
Expected: FAIL — `./apiClient` module doesn't exist

- [ ] **Step 10: Write `mini-app/src/apiClient.ts`**

```typescript
import { getInitData } from './telegram';

const BASE_URL = '/api';

async function parseErrorAndThrow(res: Response): Promise<never> {
  const payload = await res.json().catch(() => ({ error: res.statusText }));
  throw new Error(payload.error ?? `request failed with status ${res.status}`);
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${BASE_URL}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      'X-Telegram-Init-Data': getInitData(),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) return parseErrorAndThrow(res);
  if (res.status === 204) return undefined as T;
  return res.json();
}

export const api = {
  get: <T>(path: string) => request<T>('GET', path),
  post: <T>(path: string, body?: unknown) => request<T>('POST', path, body),
  put: <T>(path: string, body?: unknown) => request<T>('PUT', path, body),
};

export async function uploadAvailabilityImage(
  vendorId: number,
  brandId: number,
  weightId: number,
  file: File
): Promise<{ entries: { name: string; available: boolean }[] }> {
  const form = new FormData();
  form.append('vendorId', String(vendorId));
  form.append('brandId', String(brandId));
  form.append('weightId', String(weightId));
  form.append('image', file);

  const res = await fetch(`${BASE_URL}/admin/availability/parse`, {
    method: 'POST',
    headers: { 'X-Telegram-Init-Data': getInitData() },
    body: form,
  });
  if (!res.ok) return parseErrorAndThrow(res);
  return res.json();
}
```

- [ ] **Step 11: Run test to verify it passes**

Run: `npm run test --workspace=@tobacconist/mini-app -- apiClient`
Expected: PASS (2 tests)

- [ ] **Step 12: Write `mini-app/src/types.ts`**

```typescript
export type Me = { id: number; telegramId: string; displayName: string; role: 'admin' | 'member' };
```

- [ ] **Step 13: Write the failing test for `App.tsx`**

```typescript
// mini-app/src/App.test.tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { App } from './App';

vi.mock('./apiClient', () => ({
  api: { get: vi.fn().mockResolvedValue({ id: 1, telegramId: '1', displayName: 'Admin', role: 'admin' }) },
}));

describe('App', () => {
  it('renders the admin shell once /api/me resolves', async () => {
    render(<App />);
    expect(await screen.findByTestId('shell')).toHaveTextContent('Админ-панель');
  });
});
```

- [ ] **Step 14: Run test to verify it fails**

Run: `npm run test --workspace=@tobacconist/mini-app -- App.test`
Expected: FAIL — `./App` module doesn't exist

- [ ] **Step 15: Write `mini-app/src/App.tsx`**

```tsx
import { useEffect, useState } from 'react';
import { api } from './apiClient';
import type { Me } from './types';

export function App() {
  const [me, setMe] = useState<Me | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .get<Me>('/me')
      .then(setMe)
      .catch((e: Error) => setError(e.message));
  }, []);

  if (error) return <p role="alert">{error}</p>;
  if (!me) return <p>Загрузка...</p>;

  return <p data-testid="shell">{me.role === 'admin' ? 'Админ-панель' : 'Мой заказ'}</p>;
}
```

- [ ] **Step 16: Run test to verify it passes**

Run: `npm run test --workspace=@tobacconist/mini-app -- App.test`
Expected: PASS (1 test)

- [ ] **Step 17: Write `mini-app/src/main.tsx`**

```tsx
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>
);
```

- [ ] **Step 18: Commit**

```bash
git add mini-app/ server/src/api/app.ts
git commit -m "feat(mini-app): scaffold Vite/React app with Telegram SDK, typed API client, and role-based shell"
```

---

### Task 25: Mini App — admin catalog, price, and availability screens

**Files:**
- Create: `mini-app/src/admin/AdminCatalogPage.tsx`
- Modify: `mini-app/package.json` (add `@testing-library/user-event` devDependency)
- Modify: `mini-app/src/App.tsx` (render `AdminCatalogPage` for admins)
- Test: `mini-app/src/admin/AdminCatalogPage.test.tsx`

**Interfaces:**
- Consumes: `api`, `uploadAvailabilityImage` (Task 24) calling `GET/POST /api/admin/vendors`, `GET/POST /api/admin/brands`, `GET /api/admin/weights`, `GET/PUT /api/admin/vendors/:id/prices[/:brandId]`, `POST /api/admin/availability/parse`+`/confirm` (Tasks 15-16)
- Produces: `AdminCatalogPage` component
- Consumed by: `App.tsx`

- [ ] **Step 1: Modify `mini-app/package.json`** — add the devDependency

```json
"@testing-library/user-event": "^14.5.0"
```

- [ ] **Step 2: Write the failing tests**

```typescript
// mini-app/src/admin/AdminCatalogPage.test.tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AdminCatalogPage } from './AdminCatalogPage';
import { api, uploadAvailabilityImage } from '../apiClient';

vi.mock('../apiClient', () => ({
  api: { get: vi.fn(), post: vi.fn(), put: vi.fn() },
  uploadAvailabilityImage: vi.fn(),
}));

const vendors = [{ id: 1, name: 'Vasya', archived: false }];
const brands = [{ id: 1, name: 'DarkSide' }];
const weights = [{ id: 1, grams: 250 }];

beforeEach(() => {
  vi.mocked(api.get).mockImplementation(async (path: string) => {
    if (path === '/admin/vendors') return vendors;
    if (path === '/admin/brands') return brands;
    if (path === '/admin/weights') return weights;
    if (path.startsWith('/admin/vendors/1/prices')) return [];
    return [];
  });
  vi.mocked(api.post).mockResolvedValue({});
});

describe('AdminCatalogPage', () => {
  it('creates a new vendor from the input field', async () => {
    const user = userEvent.setup();
    render(<AdminCatalogPage />);
    await screen.findByText('Vasya');

    await user.type(screen.getByPlaceholderText('Новый барыга'), 'Kolya');
    await user.click(screen.getByText('Добавить барыгу'));

    expect(api.post).toHaveBeenCalledWith('/admin/vendors', { name: 'Kolya' });
  });

  it('uploads an image, shows the proposed entries, and confirms them', async () => {
    const user = userEvent.setup();
    vi.mocked(uploadAvailabilityImage).mockResolvedValue({
      entries: [{ name: 'CyberKiwi', available: true }],
    });
    render(<AdminCatalogPage />);

    await user.click(await screen.findByText('Vasya'));
    await user.selectOptions(screen.getByDisplayValue('Бренд...'), '1');
    await user.selectOptions(screen.getByDisplayValue('Граммовка...'), '1');

    const file = new File(['bytes'], 'photo.jpg', { type: 'image/jpeg' });
    const fileInput = screen.getByLabelText('Файл наличия', { selector: 'input' }) as HTMLInputElement;
    await user.upload(fileInput, file);

    expect(await screen.findByText('CyberKiwi')).toBeInTheDocument();

    await user.click(screen.getByText('Сохранить наличие'));
    await waitFor(() =>
      expect(api.post).toHaveBeenCalledWith('/admin/availability/confirm', {
        vendorId: 1,
        brandId: 1,
        weightId: 1,
        entries: [{ name: 'CyberKiwi', available: true }],
      })
    );
  });
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `npm run test --workspace=@tobacconist/mini-app -- AdminCatalogPage`
Expected: FAIL — `./AdminCatalogPage` module doesn't exist

- [ ] **Step 4: Write `mini-app/src/admin/AdminCatalogPage.tsx`**

```tsx
import { useEffect, useState } from 'react';
import { api, uploadAvailabilityImage } from '../apiClient';

type Vendor = { id: number; name: string; archived: boolean };
type Brand = { id: number; name: string };
type Weight = { id: number; grams: number };
type PriceRow = { vendorId: number; brandId: number; brandName: string; pricePerKgEur: number };
type AvailabilityEntry = { name: string; available: boolean };

export function AdminCatalogPage() {
  const [vendors, setVendors] = useState<Vendor[]>([]);
  const [brands, setBrands] = useState<Brand[]>([]);
  const [weights, setWeights] = useState<Weight[]>([]);
  const [selectedVendorId, setSelectedVendorId] = useState<number | null>(null);
  const [prices, setPrices] = useState<PriceRow[]>([]);
  const [newVendorName, setNewVendorName] = useState('');
  const [newBrandName, setNewBrandName] = useState('');
  const [priceInputs, setPriceInputs] = useState<Record<number, string>>({});

  const [uploadBrandId, setUploadBrandId] = useState<number | null>(null);
  const [uploadWeightId, setUploadWeightId] = useState<number | null>(null);
  const [proposedEntries, setProposedEntries] = useState<AvailabilityEntry[] | null>(null);
  const [uploading, setUploading] = useState(false);

  async function reloadCatalog() {
    setVendors(await api.get<Vendor[]>('/admin/vendors'));
    setBrands(await api.get<Brand[]>('/admin/brands'));
    setWeights(await api.get<Weight[]>('/admin/weights'));
  }

  useEffect(() => {
    reloadCatalog();
  }, []);

  useEffect(() => {
    if (selectedVendorId == null) {
      setPrices([]);
      return;
    }
    api.get<PriceRow[]>(`/admin/vendors/${selectedVendorId}/prices`).then(setPrices);
  }, [selectedVendorId]);

  async function createVendor() {
    if (!newVendorName.trim()) return;
    await api.post('/admin/vendors', { name: newVendorName.trim() });
    setNewVendorName('');
    await reloadCatalog();
  }

  async function createBrand() {
    if (!newBrandName.trim()) return;
    await api.post('/admin/brands', { name: newBrandName.trim() });
    setNewBrandName('');
    await reloadCatalog();
  }

  async function savePrice(brandId: number) {
    if (selectedVendorId == null) return;
    const value = Number(priceInputs[brandId]);
    if (!value || value <= 0) return;
    await api.put(`/admin/vendors/${selectedVendorId}/prices/${brandId}`, { pricePerKgEur: value });
    setPrices(await api.get<PriceRow[]>(`/admin/vendors/${selectedVendorId}/prices`));
  }

  async function handleFileSelected(file: File | undefined) {
    if (!file || selectedVendorId == null || uploadBrandId == null || uploadWeightId == null) return;
    setUploading(true);
    try {
      const { entries } = await uploadAvailabilityImage(selectedVendorId, uploadBrandId, uploadWeightId, file);
      setProposedEntries(entries);
    } finally {
      setUploading(false);
    }
  }

  function toggleEntry(index: number) {
    if (!proposedEntries) return;
    const next = [...proposedEntries];
    next[index] = { ...next[index], available: !next[index].available };
    setProposedEntries(next);
  }

  async function confirmAvailability() {
    if (selectedVendorId == null || uploadBrandId == null || uploadWeightId == null || !proposedEntries) return;
    await api.post('/admin/availability/confirm', {
      vendorId: selectedVendorId,
      brandId: uploadBrandId,
      weightId: uploadWeightId,
      entries: proposedEntries,
    });
    setProposedEntries(null);
  }

  return (
    <section>
      <h2>Барыги</h2>
      <ul>
        {vendors.map((v) => (
          <li key={v.id}>
            <button onClick={() => setSelectedVendorId(v.id)}>{v.name}</button>
          </li>
        ))}
      </ul>
      <input value={newVendorName} onChange={(e) => setNewVendorName(e.target.value)} placeholder="Новый барыга" />
      <button onClick={createVendor}>Добавить барыгу</button>

      <h2>Бренды</h2>
      <ul>
        {brands.map((b) => (
          <li key={b.id}>{b.name}</li>
        ))}
      </ul>
      <input value={newBrandName} onChange={(e) => setNewBrandName(e.target.value)} placeholder="Новый бренд" />
      <button onClick={createBrand}>Добавить бренд</button>

      {selectedVendorId != null && (
        <>
          <h2>Цены (€/кг)</h2>
          <ul>
            {brands.map((b) => {
              const existing = prices.find((p) => p.brandId === b.id);
              return (
                <li key={b.id}>
                  {b.name}: {existing ? `${existing.pricePerKgEur} €/кг` : 'не задано'}
                  <input
                    value={priceInputs[b.id] ?? ''}
                    onChange={(e) => setPriceInputs({ ...priceInputs, [b.id]: e.target.value })}
                  />
                  <button onClick={() => savePrice(b.id)}>Сохранить</button>
                </li>
              );
            })}
          </ul>

          <h2>Загрузить наличие</h2>
          <select
            value={uploadBrandId ?? ''}
            onChange={(e) => setUploadBrandId(Number(e.target.value) || null)}
          >
            <option value="">Бренд...</option>
            {brands.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </select>
          <select
            value={uploadWeightId ?? ''}
            onChange={(e) => setUploadWeightId(Number(e.target.value) || null)}
          >
            <option value="">Граммовка...</option>
            {weights.map((w) => (
              <option key={w.id} value={w.id}>
                {w.grams}г
              </option>
            ))}
          </select>
          <label>
            Файл наличия
            <input
              type="file"
              accept="image/*"
              disabled={uploading}
              onChange={(e) => handleFileSelected(e.target.files?.[0])}
            />
          </label>

          {proposedEntries && (
            <div>
              <h3>Проверь распознанное</h3>
              <ul>
                {proposedEntries.map((entry, i) => (
                  <li key={entry.name}>
                    <label>
                      <input type="checkbox" checked={entry.available} onChange={() => toggleEntry(i)} />
                      {entry.name}
                    </label>
                  </li>
                ))}
              </ul>
              <button onClick={confirmAvailability}>Сохранить наличие</button>
            </div>
          )}
        </>
      )}
    </section>
  );
}
```

- [ ] **Step 5: Modify `mini-app/src/App.tsx`** — render the admin catalog page for admins

```tsx
import { useEffect, useState } from 'react';
import { api } from './apiClient';
import type { Me } from './types';
import { AdminCatalogPage } from './admin/AdminCatalogPage';

export function App() {
  const [me, setMe] = useState<Me | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .get<Me>('/me')
      .then(setMe)
      .catch((e: Error) => setError(e.message));
  }, []);

  if (error) return <p role="alert">{error}</p>;
  if (!me) return <p>Загрузка...</p>;

  if (me.role === 'admin') {
    return (
      <div data-testid="shell">
        <AdminCatalogPage />
      </div>
    );
  }

  return <p data-testid="shell">Мой заказ</p>;
}
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `npm run test --workspace=@tobacconist/mini-app -- AdminCatalogPage`
Expected: PASS (2 tests)

- [ ] **Step 7: Commit**

```bash
git add mini-app/src/admin/AdminCatalogPage.tsx mini-app/src/admin/AdminCatalogPage.test.tsx mini-app/src/App.tsx mini-app/package.json
git commit -m "feat(mini-app): add admin catalog, price, and availability upload screen"
```

---

### Task 26: Mini App — admin round control, snapshot, checklist, and payments

**Files:**
- Create: `mini-app/src/admin/AdminRoundPage.tsx`
- Modify: `mini-app/src/App.tsx` (render `AdminRoundPage` alongside `AdminCatalogPage`, tab-switched)
- Test: `mini-app/src/admin/AdminRoundPage.test.tsx`

**Interfaces:**
- Consumes: `api` (Task 24) calling `GET /api/rounds/active`, `POST /api/rounds`, `POST /api/rounds/:id/close`, `POST /api/rounds/:id/reopen` (Task 17); `GET /api/admin/vendors` (Task 15); `GET /api/rounds/:id/snapshot`, `POST /api/rounds/:id/snapshot/export` (Task 19); `GET /api/rounds/:id/checklist`, `POST /api/rounds/:id/checklist/:itemId/adjust` (Task 20); `GET /api/rounds/:id/payments`, `POST /api/rounds/:id/payments/:userId` (Task 21)
- Produces: `AdminRoundPage` component
- Consumed by: `App.tsx`

- [ ] **Step 1: Write the failing tests**

```typescript
// mini-app/src/admin/AdminRoundPage.test.tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AdminRoundPage } from './AdminRoundPage';
import { api } from '../apiClient';

vi.mock('../apiClient', () => ({ api: { get: vi.fn(), post: vi.fn(), put: vi.fn() } }));

describe('AdminRoundPage — no active round', () => {
  it('lists vendors and starts a round on click', async () => {
    vi.mocked(api.get).mockImplementation(async (path: string) => {
      if (path === '/rounds/active') return null;
      if (path === '/admin/vendors') return [{ id: 1, name: 'Vasya', archived: false }];
      return [];
    });
    vi.mocked(api.post).mockResolvedValue({ id: 5, vendorId: 1, vendorName: 'Vasya', status: 'open', openedAt: '', closedAt: null });

    const user = userEvent.setup();
    render(<AdminRoundPage />);
    await user.click(await screen.findByText('Vasya'));

    expect(api.post).toHaveBeenCalledWith('/rounds', { vendorId: 1 });
  });
});

describe('AdminRoundPage — open round', () => {
  const round = { id: 5, vendorId: 1, vendorName: 'Vasya', status: 'open', openedAt: '', closedAt: null };

  beforeEach(() => {
    vi.mocked(api.get).mockImplementation(async (path: string) => {
      if (path === '/rounds/active') return round;
      if (path === '/rounds/5/snapshot') {
        return { text: 'DarkSide - CyberKiwi - 250g - x3', table: [{ brand: 'DarkSide', flavor: 'CyberKiwi', weight: '250g', quantity: 3, totalEur: 15 }] };
      }
      if (path === '/rounds/5/payments') return [{ userId: 2, displayName: 'Friend', paid: false }];
      return [];
    });
    vi.mocked(api.post).mockResolvedValue({});
  });

  it('shows the snapshot text and closes the round', async () => {
    const user = userEvent.setup();
    render(<AdminRoundPage />);
    await screen.findByText(/CyberKiwi - 250g - x3/);

    await user.click(screen.getByText('Закрыть раунд'));
    expect(api.post).toHaveBeenCalledWith('/rounds/5/close');
  });

  it('toggles a participant paid status', async () => {
    const user = userEvent.setup();
    render(<AdminRoundPage />);
    const checkbox = await screen.findByLabelText('Friend');
    await user.click(checkbox);
    await waitFor(() => expect(api.post).toHaveBeenCalledWith('/rounds/5/payments/2', { paid: true }));
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm run test --workspace=@tobacconist/mini-app -- AdminRoundPage`
Expected: FAIL — `./AdminRoundPage` module doesn't exist

- [ ] **Step 3: Write `mini-app/src/admin/AdminRoundPage.tsx`**

```tsx
import { useEffect, useState, useCallback } from 'react';
import { api } from '../apiClient';

type Round = { id: number; vendorId: number; vendorName: string; status: 'open' | 'closed'; openedAt: string; closedAt: string | null };
type Vendor = { id: number; name: string; archived: boolean };
type TableRow = { brand: string; flavor: string; weight: string; quantity: number; totalEur: number };
type Snapshot = { text: string; table: TableRow[] };
type ChecklistItem = { id: number; brandName: string; flavorName: string; grams: number; expectedQty: number; receivedQty: number };
type Payment = { userId: number; displayName: string; paid: boolean };

export function AdminRoundPage() {
  const [round, setRound] = useState<Round | null | undefined>(undefined);
  const [vendors, setVendors] = useState<Vendor[]>([]);
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [checklist, setChecklist] = useState<ChecklistItem[]>([]);
  const [payments, setPayments] = useState<Payment[]>([]);

  const loadRound = useCallback(async () => {
    const active = await api.get<Round | null>('/rounds/active');
    setRound(active);
  }, []);

  useEffect(() => {
    loadRound();
    api.get<Vendor[]>('/admin/vendors').then(setVendors);
  }, [loadRound]);

  useEffect(() => {
    if (!round) {
      setSnapshot(null);
      setChecklist([]);
      setPayments([]);
      return;
    }
    api.get<Snapshot>(`/rounds/${round.id}/snapshot`).then(setSnapshot);
    api.get<Payment[]>(`/rounds/${round.id}/payments`).then(setPayments);
    if (round.status === 'closed') {
      api.get<ChecklistItem[]>(`/rounds/${round.id}/checklist`).then(setChecklist);
    }
  }, [round]);

  async function startRound(vendorId: number) {
    await api.post('/rounds', { vendorId });
    await loadRound();
  }

  async function closeRound() {
    if (!round) return;
    await api.post(`/rounds/${round.id}/close`);
    await loadRound();
  }

  async function reopenRound() {
    if (!round) return;
    await api.post(`/rounds/${round.id}/reopen`);
    await loadRound();
  }

  async function adjustChecklist(itemId: number, delta: number) {
    if (!round) return;
    await api.post<ChecklistItem>(`/rounds/${round.id}/checklist/${itemId}/adjust`, { delta });
    setChecklist(await api.get<ChecklistItem[]>(`/rounds/${round.id}/checklist`));
  }

  async function togglePaid(userId: number, paid: boolean) {
    if (!round) return;
    await api.post(`/rounds/${round.id}/payments/${userId}`, { paid });
    setPayments(await api.get<Payment[]>(`/rounds/${round.id}/payments`));
  }

  async function exportSnapshot() {
    if (!round) return;
    await api.post(`/rounds/${round.id}/snapshot/export`);
  }

  if (round === undefined) return <p>Загрузка...</p>;

  if (round === null) {
    return (
      <section>
        <h2>Начать раунд</h2>
        <ul>
          {vendors.map((v) => (
            <li key={v.id}>
              <button onClick={() => startRound(v.id)}>{v.name}</button>
            </li>
          ))}
        </ul>
      </section>
    );
  }

  return (
    <section>
      <h2>
        Раунд #{round.id} — {round.vendorName} ({round.status})
      </h2>
      {round.status === 'open' ? (
        <button onClick={closeRound}>Закрыть раунд</button>
      ) : (
        <button onClick={reopenRound}>Переоткрыть раунд</button>
      )}

      {snapshot && (
        <div>
          <h3>Слепок</h3>
          <pre>{snapshot.text}</pre>
          <button onClick={() => navigator.clipboard?.writeText(snapshot.text)}>Скопировать</button>
          <button onClick={exportSnapshot}>Выгрузить в Telegram</button>
        </div>
      )}

      {round.status === 'closed' && (
        <div>
          <h3>Сверка поставки</h3>
          <ul>
            {checklist.map((item) => (
              <li key={item.id}>
                {item.brandName} - {item.flavorName} - {item.grams}г: нужно {item.expectedQty}, привезли{' '}
                {item.receivedQty}
                <button onClick={() => adjustChecklist(item.id, -1)}>-</button>
                <button onClick={() => adjustChecklist(item.id, 1)}>+</button>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div>
        <h3>Оплаты</h3>
        <ul>
          {payments.map((p) => (
            <li key={p.userId}>
              <label>
                <input
                  type="checkbox"
                  checked={p.paid}
                  onChange={(e) => togglePaid(p.userId, e.target.checked)}
                />
                {p.displayName}
              </label>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
```

- [ ] **Step 4: Modify `mini-app/src/App.tsx`** — add a simple tab switch between the two admin screens

```tsx
import { useEffect, useState } from 'react';
import { api } from './apiClient';
import type { Me } from './types';
import { AdminCatalogPage } from './admin/AdminCatalogPage';
import { AdminRoundPage } from './admin/AdminRoundPage';

export function App() {
  const [me, setMe] = useState<Me | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [adminTab, setAdminTab] = useState<'round' | 'catalog'>('round');

  useEffect(() => {
    api
      .get<Me>('/me')
      .then(setMe)
      .catch((e: Error) => setError(e.message));
  }, []);

  if (error) return <p role="alert">{error}</p>;
  if (!me) return <p>Загрузка...</p>;

  if (me.role === 'admin') {
    return (
      <div data-testid="shell">
        <nav>
          <button onClick={() => setAdminTab('round')}>Раунд</button>
          <button onClick={() => setAdminTab('catalog')}>Каталог</button>
        </nav>
        {adminTab === 'round' ? <AdminRoundPage /> : <AdminCatalogPage />}
      </div>
    );
  }

  return <p data-testid="shell">Мой заказ</p>;
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npm run test --workspace=@tobacconist/mini-app -- AdminRoundPage`
Expected: PASS (3 tests)

- [ ] **Step 6: Commit**

```bash
git add mini-app/src/admin/AdminRoundPage.tsx mini-app/src/admin/AdminRoundPage.test.tsx mini-app/src/App.tsx
git commit -m "feat(mini-app): add admin round control, snapshot, checklist, and payments screen"
```

---

### Task 27: Mini App — participant order builder and history

**Files:**
- Create: `mini-app/src/participant/OrderBuilderPage.tsx`
- Create: `mini-app/src/participant/HistoryPage.tsx`
- Modify: `mini-app/src/App.tsx` (render these for `role: 'member'`, tab-switched)
- Test: `mini-app/src/participant/OrderBuilderPage.test.tsx`
- Test: `mini-app/src/participant/HistoryPage.test.tsx`

**Interfaces:**
- Consumes: `api` (Task 24) calling `GET /api/orders/assortment`, `GET /api/orders/mine`, `PUT /api/orders/items` (Task 18); `GET /api/history`, `GET /api/history/:roundId` (Task 21)
- Produces: `OrderBuilderPage`, `HistoryPage` components
- Consumed by: `App.tsx`

- [ ] **Step 1: Write the failing tests for `OrderBuilderPage`**

```typescript
// mini-app/src/participant/OrderBuilderPage.test.tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { OrderBuilderPage } from './OrderBuilderPage';
import { api } from '../apiClient';

vi.mock('../apiClient', () => ({ api: { get: vi.fn(), post: vi.fn(), put: vi.fn() } }));

describe('OrderBuilderPage', () => {
  it('shows a message when there is no active round', async () => {
    vi.mocked(api.get).mockImplementation(async (path: string) => {
      if (path === '/orders/assortment') return [];
      if (path === '/orders/mine') return { round: null, items: [], totalKg: 0, totalEur: 0, hasUnavailableItems: false };
      return [];
    });
    render(<OrderBuilderPage />);
    expect(await screen.findByText(/нет активной закупки/i)).toBeInTheDocument();
  });

  it('renders assortment, prefills existing quantity, and saves on blur', async () => {
    vi.mocked(api.get).mockImplementation(async (path: string) => {
      if (path === '/orders/assortment') {
        return [{ brandId: 1, brandName: 'DarkSide', flavorId: 1, flavorName: 'CyberKiwi', weightId: 1, grams: 250, available: true }];
      }
      if (path === '/orders/mine') {
        return {
          round: { id: 5, vendorId: 1, status: 'open' },
          items: [{ brandId: 1, brandName: 'DarkSide', flavorId: 1, flavorName: 'CyberKiwi', weightId: 1, grams: 250, quantity: 2, totalEur: 10 }],
          totalKg: 0.5,
          totalEur: 10,
          hasUnavailableItems: false,
        };
      }
      return [];
    });
    vi.mocked(api.put).mockResolvedValue({});

    const user = userEvent.setup();
    render(<OrderBuilderPage />);
    const input = (await screen.findByLabelText(/CyberKiwi/)) as HTMLInputElement;
    expect(input.value).toBe('2');

    await user.clear(input);
    await user.type(input, '5');
    await user.tab();

    await waitFor(() =>
      expect(api.put).toHaveBeenCalledWith('/orders/items', { brandId: 1, flavorId: 1, weightId: 1, quantity: 5 })
    );
    expect(await screen.findByText(/0.50 кг, 10.00 €/)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test --workspace=@tobacconist/mini-app -- OrderBuilderPage`
Expected: FAIL — `./OrderBuilderPage` module doesn't exist

- [ ] **Step 3: Write `mini-app/src/participant/OrderBuilderPage.tsx`**

```tsx
import { useEffect, useState } from 'react';
import { api } from '../apiClient';

type AssortmentRow = {
  brandId: number;
  brandName: string;
  flavorId: number;
  flavorName: string;
  weightId: number;
  grams: number;
  available: boolean;
};
type AggregateLine = {
  brandId: number;
  flavorId: number;
  weightId: number;
  quantity: number;
};
type MyOrder = {
  round: { id: number; vendorId: number; status: string } | null;
  items: AggregateLine[];
  totalKg: number;
  totalEur: number;
  hasUnavailableItems: boolean;
};

function lineKey(brandId: number, flavorId: number, weightId: number) {
  return `${brandId}:${flavorId}:${weightId}`;
}

export function OrderBuilderPage() {
  const [assortment, setAssortment] = useState<AssortmentRow[]>([]);
  const [mine, setMine] = useState<MyOrder | null>(null);
  const [quantities, setQuantities] = useState<Record<string, string>>({});

  async function reload() {
    setAssortment(await api.get<AssortmentRow[]>('/orders/assortment'));
    const myOrder = await api.get<MyOrder>('/orders/mine');
    setMine(myOrder);
    const q: Record<string, string> = {};
    for (const item of myOrder.items) {
      q[lineKey(item.brandId, item.flavorId, item.weightId)] = String(item.quantity);
    }
    setQuantities(q);
  }

  useEffect(() => {
    reload();
  }, []);

  async function saveQuantity(row: AssortmentRow) {
    const key = lineKey(row.brandId, row.flavorId, row.weightId);
    const quantity = Number(quantities[key] ?? 0);
    await api.put('/orders/items', {
      brandId: row.brandId,
      flavorId: row.flavorId,
      weightId: row.weightId,
      quantity,
    });
    setMine(await api.get<MyOrder>('/orders/mine'));
  }

  if (!mine?.round) {
    return <p>Сейчас нет активной закупки.</p>;
  }

  const byBrand = new Map<string, AssortmentRow[]>();
  for (const row of assortment) {
    const list = byBrand.get(row.brandName) ?? [];
    list.push(row);
    byBrand.set(row.brandName, list);
  }

  return (
    <section>
      <h2>Мой заказ</h2>
      {[...byBrand.entries()].map(([brandName, rows]) => (
        <div key={brandName}>
          <h3>{brandName}</h3>
          <ul>
            {rows.map((row) => {
              const key = lineKey(row.brandId, row.flavorId, row.weightId);
              return (
                <li key={key}>
                  <label>
                    {row.flavorName} - {row.grams}г
                    <input
                      type="number"
                      min={0}
                      value={quantities[key] ?? ''}
                      onChange={(e) => setQuantities({ ...quantities, [key]: e.target.value })}
                      onBlur={() => saveQuantity(row)}
                    />
                  </label>
                </li>
              );
            })}
          </ul>
        </div>
      ))}

      <h3>Итого</h3>
      <p>
        {mine.totalKg.toFixed(2)} кг, {mine.totalEur.toFixed(2)} €
      </p>
      {mine.hasUnavailableItems && <p role="alert">Часть позиций больше не в наличии</p>}
    </section>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test --workspace=@tobacconist/mini-app -- OrderBuilderPage`
Expected: PASS (2 tests)

- [ ] **Step 5: Write the failing test for `HistoryPage`**

```typescript
// mini-app/src/participant/HistoryPage.test.tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { HistoryPage } from './HistoryPage';
import { api } from '../apiClient';

vi.mock('../apiClient', () => ({ api: { get: vi.fn(), post: vi.fn(), put: vi.fn() } }));

describe('HistoryPage', () => {
  it('lists closed rounds and shows the selected round detail on click', async () => {
    vi.mocked(api.get).mockImplementation(async (path: string) => {
      if (path === '/history') {
        return [{ id: 7, vendorId: 1, vendorName: 'Vasya', status: 'closed', openedAt: '', closedAt: '2026-08-01' }];
      }
      if (path === '/history/7') {
        return {
          round: { id: 7, vendorId: 1, vendorName: 'Vasya', status: 'closed', openedAt: '', closedAt: '2026-08-01' },
          items: [],
          totalKg: 0.75,
          totalEur: 15,
          paid: true,
        };
      }
      return [];
    });

    const user = userEvent.setup();
    render(<HistoryPage />);
    await user.click(await screen.findByText(/Vasya/));

    expect(await screen.findByText(/0.75 кг, 15.00 €/)).toBeInTheDocument();
    expect(screen.getByText(/оплачено/)).toBeInTheDocument();
  });
});
```

- [ ] **Step 6: Run test to verify it fails**

Run: `npm run test --workspace=@tobacconist/mini-app -- HistoryPage`
Expected: FAIL — `./HistoryPage` module doesn't exist

- [ ] **Step 7: Write `mini-app/src/participant/HistoryPage.tsx`**

```tsx
import { useEffect, useState } from 'react';
import { api } from '../apiClient';

type RoundSummary = {
  id: number;
  vendorId: number;
  vendorName: string;
  status: 'open' | 'closed';
  openedAt: string;
  closedAt: string | null;
};
type RoundDetail = {
  round: RoundSummary;
  items: unknown[];
  totalKg: number;
  totalEur: number;
  paid: boolean;
};

export function HistoryPage() {
  const [rounds, setRounds] = useState<RoundSummary[]>([]);
  const [selected, setSelected] = useState<RoundDetail | null>(null);

  useEffect(() => {
    api.get<RoundSummary[]>('/history').then(setRounds);
  }, []);

  async function openRound(id: number) {
    setSelected(await api.get<RoundDetail>(`/history/${id}`));
  }

  return (
    <section>
      <h2>История закупок</h2>
      <ul>
        {rounds.map((r) => (
          <li key={r.id}>
            <button onClick={() => openRound(r.id)}>
              {r.vendorName} — {r.closedAt}
            </button>
          </li>
        ))}
      </ul>
      {selected && (
        <h3>
          {selected.round.vendorName}: {selected.totalKg.toFixed(2)} кг, {selected.totalEur.toFixed(2)} € —{' '}
          {selected.paid ? 'оплачено' : 'не оплачено'}
        </h3>
      )}
    </section>
  );
}
```

- [ ] **Step 8: Run test to verify it passes**

Run: `npm run test --workspace=@tobacconist/mini-app -- HistoryPage`
Expected: PASS (1 test)

- [ ] **Step 9: Modify `mini-app/src/App.tsx`** — render participant screens for `role: 'member'`, tab-switched

```tsx
import { useEffect, useState } from 'react';
import { api } from './apiClient';
import type { Me } from './types';
import { AdminCatalogPage } from './admin/AdminCatalogPage';
import { AdminRoundPage } from './admin/AdminRoundPage';
import { OrderBuilderPage } from './participant/OrderBuilderPage';
import { HistoryPage } from './participant/HistoryPage';

export function App() {
  const [me, setMe] = useState<Me | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [adminTab, setAdminTab] = useState<'round' | 'catalog'>('round');
  const [memberTab, setMemberTab] = useState<'order' | 'history'>('order');

  useEffect(() => {
    api
      .get<Me>('/me')
      .then(setMe)
      .catch((e: Error) => setError(e.message));
  }, []);

  if (error) return <p role="alert">{error}</p>;
  if (!me) return <p>Загрузка...</p>;

  if (me.role === 'admin') {
    return (
      <div data-testid="shell">
        <nav>
          <button onClick={() => setAdminTab('round')}>Раунд</button>
          <button onClick={() => setAdminTab('catalog')}>Каталог</button>
        </nav>
        {adminTab === 'round' ? <AdminRoundPage /> : <AdminCatalogPage />}
      </div>
    );
  }

  return (
    <div data-testid="shell">
      <nav>
        <button onClick={() => setMemberTab('order')}>Заказ</button>
        <button onClick={() => setMemberTab('history')}>История</button>
      </nav>
      {memberTab === 'order' ? <OrderBuilderPage /> : <HistoryPage />}
    </div>
  );
}
```

- [ ] **Step 10: Commit**

```bash
git add mini-app/src/participant/ mini-app/src/App.tsx
git commit -m "feat(mini-app): add participant order builder and history screens"
```

---

### Task 28: Deployment — Dockerfile, Traefik-fronted compose, env example, webhook script

**Files:**
- Create: `Dockerfile`
- Create: `deploy/docker-compose.yml`
- Create: `deploy/.env.example`
- Create: `deploy/scripts/set-webhook.sh`

**Note:** This task is infrastructure config, not application logic — there is no unit test cycle. Each step is verified by running the tool against the file (`docker compose config`, `docker build`) rather than `vitest`.

**Interfaces:**
- Consumes: `server/dist/index.js` (built output of Task 23), `mini-app/dist` (built output of Task 24-27), `server/src/db/migrations/0000_init.sql` (Task 2)
- Produces: a deployable container image exposing port 3000, and operator scripts for the VPS
- Assumes: Traefik is already running on the VPS as an external Docker network named `traefik`, with a certificate resolver named `le` — adjust the labels below to match the operator's actual Traefik setup if different

- [ ] **Step 1: Write `Dockerfile`**

```dockerfile
FROM node:20-slim AS build
WORKDIR /app
COPY package.json tsconfig.base.json ./
COPY shared/package.json shared/package.json
COPY server/package.json server/package.json
COPY mini-app/package.json mini-app/package.json
RUN npm install
COPY . .
RUN npm run build --workspace=@tobacconist/shared
RUN npm run build --workspace=@tobacconist/server
RUN npm run build --workspace=@tobacconist/mini-app

FROM node:20-slim
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/server/dist ./server/dist
COPY --from=build /app/server/src/db/migrations ./server/dist/db/migrations
COPY --from=build /app/mini-app/dist ./mini-app/dist
COPY --from=build /app/server/package.json ./server/package.json
EXPOSE 3000
CMD ["node", "server/dist/index.js"]
```

- [ ] **Step 2: Run: `docker build -t tobacconist .`**

Expected: image builds successfully (verifies the monorepo build steps and file layout are correct)

- [ ] **Step 3: Write `deploy/.env.example`**

```
BOT_TOKEN=123456:your-telegram-bot-token
TELEGRAM_ADMIN_ID=123456789
TELEGRAM_GROUP_CHAT_ID=-1001234567890
GEMINI_API_KEY=your-gemini-api-key
DB_PATH=/app/data/tobacconist.sqlite3
PORT=3000
PUBLIC_URL=https://tobacconist.example.com
PUBLIC_HOST=tobacconist.example.com
```

- [ ] **Step 4: Write `deploy/docker-compose.yml`**

```yaml
services:
  tobacconist:
    build: ..
    restart: unless-stopped
    env_file: .env
    volumes:
      - tobacconist-data:/app/data
    labels:
      - "traefik.enable=true"
      - "traefik.http.routers.tobacconist.rule=Host(`${PUBLIC_HOST}`)"
      - "traefik.http.routers.tobacconist.entrypoints=websecure"
      - "traefik.http.routers.tobacconist.tls.certresolver=le"
      - "traefik.http.services.tobacconist.loadbalancer.server.port=3000"
    networks:
      - traefik

networks:
  traefik:
    external: true

volumes:
  tobacconist-data:
```

- [ ] **Step 5: Run: `cd deploy && cp .env.example .env` (fill in real values), then `docker compose config`**

Expected: prints the fully resolved compose config with no errors (validates YAML + variable interpolation)

- [ ] **Step 6: Write `deploy/scripts/set-webhook.sh`**

```bash
#!/usr/bin/env bash
set -euo pipefail
: "${BOT_TOKEN:?set BOT_TOKEN}"
: "${PUBLIC_URL:?set PUBLIC_URL}"

curl -sS "https://api.telegram.org/bot${BOT_TOKEN}/setWebhook" \
  -d "url=${PUBLIC_URL}/telegram/webhook"
echo
curl -sS "https://api.telegram.org/bot${BOT_TOKEN}/getWebhookInfo"
echo
```

- [ ] **Step 7: Run: `chmod +x deploy/scripts/set-webhook.sh`**

- [ ] **Step 8: Manual end-to-end verification checklist (run once on the VPS after first deploy)**

1. `docker compose -f deploy/docker-compose.yml --env-file deploy/.env up -d --build`
2. Confirm Traefik issues a TLS cert and `https://<PUBLIC_HOST>/api/health` returns `{"status":"ok"}`
3. In Telegram, message the bot privately once (`/start`) so it can later DM the admin snapshot exports (spec §6)
4. Add the bot to the group chat configured as `TELEGRAM_GROUP_CHAT_ID`
5. As the admin, run `/start_round` in the group, pick a vendor, confirm the announcement with the "🛍 Заказать" button appears
6. Open the Mini App from that button, confirm the admin catalog/round screens load and a friend account sees the participant order screen

- [ ] **Step 9: Commit**

```bash
git add Dockerfile deploy/
git commit -m "chore: add Docker build, Traefik-fronted compose, and webhook setup script"
```

---

## Self-Review Notes

- **Spec coverage:** §3 data model → Task 2; §4 availability/Gemini → Tasks 4-5, 16, 25; §5 round lifecycle (incl. reopen preserving checklist progress) → Tasks 6, 9, 17; §6 snapshot text/table/export → Tasks 11-12, 19, 26; §7 checklist +/- → Tasks 9, 20, 26; §8 payments → Tasks 10, 21, 26; §9-10 summaries/history → Tasks 8, 21, 27; §2 auth/membership → Tasks 13-14; §11 stack/deploy → Tasks 1-2, 14, 23, 28; §12 edge cases (unavailable-but-ordered flagging, single active round, single admin) → Tasks 4, 6, 8, 14, 27; §13 testing approach → every domain/route task's Vitest suite plus Task 28's manual checklist; §14 out-of-scope items (no free-text AI ordering, EUR-only, fixed weights, single admin, no auto-send) are honored by omission and called out in Global Constraints.
- **Placeholder scan:** no TBD/TODO markers; every step carries runnable code or a concrete shell command.
- **Type consistency:** `AggregateLine`/`AggregateLineDto` field names (`brandId`, `brandName`, `flavorId`, `flavorName`, `weightId`, `grams`, `quantity`, `totalEur`) are used identically from Task 8 through Tasks 11, 19, and the Mini App pages; `ChecklistRow`/`ChecklistItemDto` (`expectedQty`, `receivedQty`) match from Task 9 through Task 20 and Task 26; `AuthedUser` (`id`, `telegramId`, `displayName`, `role`) is defined once in Task 14 and reused unchanged through Tasks 15-23.

