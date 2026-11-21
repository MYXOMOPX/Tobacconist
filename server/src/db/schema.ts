import { sqliteTable, integer, text, real } from 'drizzle-orm/sqlite-core';

export const users = sqliteTable('users', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  telegramId: text('telegram_id').notNull().unique(),
  displayName: text('display_name').notNull(),
  role: text('role', { enum: ['admin', 'member'] }).notNull().default('member'),
  firstSeenAt: text('first_seen_at').notNull(),
});

export const allowedChats = sqliteTable('allowed_chats', {
  chatId: text('chat_id').primaryKey(),
  enabledAt: text('enabled_at').notNull(),
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
  /** Null when the screenshot did not show it — the admin resolves it on review (§4). */
  brandId: integer('brand_id').references(() => brands.id),
  weightId: integer('weight_id').references(() => weights.id),
  imageRef: text('image_ref').notNull(),
  rawAiResponse: text('raw_ai_response').notNull(),
  createdAt: text('created_at').notNull(),
});

/** Spec §5: one order per vendor, at most one of them non-terminal at a time. */
export const orders = sqliteTable('orders', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  vendorId: integer('vendor_id').notNull().references(() => vendors.id),
  status: text('status', {
    enum: ['ordering', 'awaiting_validation', 'done', 'rejected'],
  }).notNull(),
  createdAt: text('created_at').notNull(),
  statusChangedAt: text('status_changed_at').notNull(),
  createdByUserId: integer('created_by_user_id').notNull().references(() => users.id),
});

export const orderPriceSnapshots = sqliteTable('order_price_snapshots', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  orderId: integer('order_id').notNull().references(() => orders.id),
  brandId: integer('brand_id').notNull().references(() => brands.id),
  pricePerKgEur: real('price_per_kg_eur').notNull(),
});

export const orderItems = sqliteTable('order_items', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  orderId: integer('order_id').notNull().references(() => orders.id),
  userId: integer('user_id').notNull().references(() => users.id),
  brandId: integer('brand_id').notNull().references(() => brands.id),
  flavorId: integer('flavor_id').notNull().references(() => flavors.id),
  weightId: integer('weight_id').notNull().references(() => weights.id),
  quantity: integer('quantity').notNull(),
  /** What this participant actually got, once the delivery was checked (§7.1). Null until then. */
  deliveredQty: integer('delivered_qty'),
  /** The participant themselves, or the admin who added the line on their behalf. */
  addedByUserId: integer('added_by_user_id').notNull().references(() => users.id),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
});

/** Readiness and payment for one (order, participant) pair — spec §3. */
export const orderParticipants = sqliteTable('order_participants', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  orderId: integer('order_id').notNull().references(() => orders.id),
  userId: integer('user_id').notNull().references(() => users.id),
  ready: integer('ready', { mode: 'boolean' }).notNull().default(false),
  readyAt: text('ready_at'),
  paid: integer('paid', { mode: 'boolean' }).notNull().default(false),
  paidMarkedAt: text('paid_marked_at'),
  paidMarkedByUserId: integer('paid_marked_by_user_id').references(() => users.id),
});

export const deliveryChecklistItems = sqliteTable('delivery_checklist_items', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  orderId: integer('order_id').notNull().references(() => orders.id),
  brandId: integer('brand_id').notNull().references(() => brands.id),
  flavorId: integer('flavor_id').notNull().references(() => flavors.id),
  weightId: integer('weight_id').notNull().references(() => weights.id),
  expectedQty: integer('expected_qty').notNull(),
  receivedQty: integer('received_qty').notNull().default(0),
});
