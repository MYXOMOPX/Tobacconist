CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  telegram_id TEXT NOT NULL UNIQUE,
  display_name TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'member',
  first_seen_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS weights (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  grams INTEGER NOT NULL UNIQUE
);

CREATE TABLE IF NOT EXISTS brands (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE
);

CREATE TABLE IF NOT EXISTS flavors (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  brand_id INTEGER NOT NULL REFERENCES brands(id),
  name TEXT NOT NULL,
  UNIQUE(brand_id, name)
);

CREATE TABLE IF NOT EXISTS vendors (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  archived INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS vendor_brand_prices (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  vendor_id INTEGER NOT NULL REFERENCES vendors(id),
  brand_id INTEGER NOT NULL REFERENCES brands(id),
  price_per_kg_eur REAL NOT NULL,
  UNIQUE(vendor_id, brand_id)
);

CREATE TABLE IF NOT EXISTS vendor_flavor_availability (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  vendor_id INTEGER NOT NULL REFERENCES vendors(id),
  flavor_id INTEGER NOT NULL REFERENCES flavors(id),
  weight_id INTEGER NOT NULL REFERENCES weights(id),
  available INTEGER NOT NULL,
  updated_at TEXT NOT NULL,
  source_upload_id INTEGER,
  UNIQUE(vendor_id, flavor_id, weight_id)
);

CREATE TABLE IF NOT EXISTS availability_uploads (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  vendor_id INTEGER NOT NULL REFERENCES vendors(id),
  brand_id INTEGER NOT NULL REFERENCES brands(id),
  weight_id INTEGER NOT NULL REFERENCES weights(id),
  image_ref TEXT NOT NULL,
  raw_ai_response TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS purchase_rounds (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  vendor_id INTEGER NOT NULL REFERENCES vendors(id),
  status TEXT NOT NULL,
  opened_at TEXT NOT NULL,
  closed_at TEXT,
  opened_by_user_id INTEGER NOT NULL REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS round_brand_price_snapshots (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  round_id INTEGER NOT NULL REFERENCES purchase_rounds(id),
  brand_id INTEGER NOT NULL REFERENCES brands(id),
  price_per_kg_eur REAL NOT NULL,
  UNIQUE(round_id, brand_id)
);

CREATE TABLE IF NOT EXISTS order_items (
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

CREATE TABLE IF NOT EXISTS round_payments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  round_id INTEGER NOT NULL REFERENCES purchase_rounds(id),
  user_id INTEGER NOT NULL REFERENCES users(id),
  paid INTEGER NOT NULL DEFAULT 0,
  marked_at TEXT,
  marked_by_user_id INTEGER REFERENCES users(id),
  UNIQUE(round_id, user_id)
);

CREATE TABLE IF NOT EXISTS delivery_checklist_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  round_id INTEGER NOT NULL REFERENCES purchase_rounds(id),
  brand_id INTEGER NOT NULL REFERENCES brands(id),
  flavor_id INTEGER NOT NULL REFERENCES flavors(id),
  weight_id INTEGER NOT NULL REFERENCES weights(id),
  expected_qty INTEGER NOT NULL,
  received_qty INTEGER NOT NULL DEFAULT 0,
  UNIQUE(round_id, brand_id, flavor_id, weight_id)
);

INSERT OR IGNORE INTO weights (grams) VALUES (100), (250);
