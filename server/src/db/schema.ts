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
