-- Purchase rounds become orders (spec §5).
--
-- The old model had one globally-open round with two states (open/closed). The
-- new one has an order per vendor with four states, several of which can be
-- active at once as long as they belong to different vendors.
--
-- Existing rounds are carried over: an open round is still collecting
-- ('ordering'), a closed one becomes 'done'. Closed is the right match for done
-- because that is exactly what the old app showed in its history — and because
-- a vendor may well have several closed rounds, which only a terminal status
-- allows (one active order per vendor).

CREATE TABLE orders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  vendor_id INTEGER NOT NULL REFERENCES vendors(id),
  status TEXT NOT NULL,
  created_at TEXT NOT NULL,
  status_changed_at TEXT NOT NULL,
  created_by_user_id INTEGER NOT NULL REFERENCES users(id)
);

-- Spec §5: at most one non-terminal order per vendor. Enforced here as well as
-- in the domain, so a race cannot produce two.
CREATE UNIQUE INDEX orders_one_active_per_vendor
  ON orders (vendor_id)
  WHERE status IN ('ordering', 'awaiting_validation');

CREATE TABLE order_price_snapshots (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id INTEGER NOT NULL REFERENCES orders(id),
  brand_id INTEGER NOT NULL REFERENCES brands(id),
  price_per_kg_eur REAL NOT NULL,
  UNIQUE(order_id, brand_id)
);

CREATE TABLE order_participants (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id INTEGER NOT NULL REFERENCES orders(id),
  user_id INTEGER NOT NULL REFERENCES users(id),
  ready INTEGER NOT NULL DEFAULT 0,
  ready_at TEXT,
  paid INTEGER NOT NULL DEFAULT 0,
  paid_marked_at TEXT,
  paid_marked_by_user_id INTEGER REFERENCES users(id),
  UNIQUE(order_id, user_id)
);

CREATE TABLE order_items_new (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id INTEGER NOT NULL REFERENCES orders(id),
  user_id INTEGER NOT NULL REFERENCES users(id),
  brand_id INTEGER NOT NULL REFERENCES brands(id),
  flavor_id INTEGER NOT NULL REFERENCES flavors(id),
  weight_id INTEGER NOT NULL REFERENCES weights(id),
  quantity INTEGER NOT NULL,
  delivered_qty INTEGER,
  added_by_user_id INTEGER NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(order_id, user_id, brand_id, flavor_id, weight_id)
);

CREATE TABLE delivery_checklist_items_new (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id INTEGER NOT NULL REFERENCES orders(id),
  brand_id INTEGER NOT NULL REFERENCES brands(id),
  flavor_id INTEGER NOT NULL REFERENCES flavors(id),
  weight_id INTEGER NOT NULL REFERENCES weights(id),
  expected_qty INTEGER NOT NULL,
  received_qty INTEGER NOT NULL DEFAULT 0,
  UNIQUE(order_id, brand_id, flavor_id, weight_id)
);

INSERT INTO orders (id, vendor_id, status, created_at, status_changed_at, created_by_user_id)
SELECT
  id,
  vendor_id,
  CASE status WHEN 'open' THEN 'ordering' ELSE 'done' END,
  opened_at,
  COALESCE(closed_at, opened_at),
  opened_by_user_id
FROM purchase_rounds;

INSERT INTO order_price_snapshots (order_id, brand_id, price_per_kg_eur)
SELECT round_id, brand_id, price_per_kg_eur FROM round_brand_price_snapshots;

-- Every carried-over line was added by the participant themselves: the old model
-- had no way for the admin to order on someone's behalf.
INSERT INTO order_items_new
  (id, order_id, user_id, brand_id, flavor_id, weight_id, quantity, delivered_qty, added_by_user_id, created_at, updated_at)
SELECT id, round_id, user_id, brand_id, flavor_id, weight_id, quantity, NULL, user_id, created_at, updated_at
FROM order_items;

INSERT INTO order_participants (order_id, user_id, ready, ready_at, paid, paid_marked_at, paid_marked_by_user_id)
SELECT round_id, user_id, 0, NULL, paid, marked_at, marked_by_user_id FROM round_payments;

INSERT INTO delivery_checklist_items_new
  (id, order_id, brand_id, flavor_id, weight_id, expected_qty, received_qty)
SELECT id, round_id, brand_id, flavor_id, weight_id, expected_qty, received_qty
FROM delivery_checklist_items;

DROP TABLE order_items;
ALTER TABLE order_items_new RENAME TO order_items;

DROP TABLE delivery_checklist_items;
ALTER TABLE delivery_checklist_items_new RENAME TO delivery_checklist_items;

DROP TABLE round_payments;
DROP TABLE round_brand_price_snapshots;
DROP TABLE purchase_rounds;
