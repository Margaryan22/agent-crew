// Database schema (Drizzle ORM, PostgreSQL). Column names are snake_case in the database
// (casing: 'snake_case' in drizzle.config.ts and db.server.ts) and camelCase in code.
// After changing this file: `npm run db:generate` (new migration in drizzle/), then `npm run db:migrate`.

import { sql } from 'drizzle-orm'
import { check, date, index, integer, pgTable, serial, text, timestamp, uuid } from 'drizzle-orm/pg-core'

// ---------------------------------------------------------------------------
// Accounts (used by src/server/*.server.ts; roles are listed in src/lib/roles.ts)

export const users = pgTable('users', {
  id: uuid().primaryKey().defaultRandom(),
  email: text().notNull().unique(),
  name: text().notNull(),
  passwordHash: text().notNull(),
  role: text().notNull().default('baker'),
  createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
})

export const sessions = pgTable(
  'sessions',
  {
    // SHA-256 of the session token; the token itself lives only in the user's cookie.
    id: text().primaryKey(),
    userId: uuid()
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    expiresAt: timestamp({ withTimezone: true }).notNull(),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('sessions_user_id_idx').on(t.userId)],
)

// ---------------------------------------------------------------------------
// Business data — add the project's tables below (see docs/architecture.md).

export const products = pgTable('products', {
  id: uuid().primaryKey().defaultRandom(),
  name: text().notNull().unique(),
  priceCents: integer().notNull(),
})

export const orders = pgTable(
  'orders',
  {
    id: uuid().primaryKey().defaultRandom(),
    number: serial().notNull().unique(),
    customerName: text().notNull(),
    phone: text().notNull(),
    pickupDate: date({ mode: 'string' }).notNull(),
    status: text().notNull().default('new'),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('orders_pickup_idx').on(t.pickupDate), check('orders_status', sql`${t.status} in ('new', 'baking', 'ready', 'picked_up', 'cancelled')`)],
)

export const orderItems = pgTable(
  'order_items',
  {
    id: uuid().primaryKey().defaultRandom(),
    orderId: uuid()
      .notNull()
      .references(() => orders.id, { onDelete: 'cascade' }),
    productId: uuid()
      .notNull()
      .references(() => products.id, { onDelete: 'restrict' }),
    quantity: integer().notNull(),
    // Price at the time of the order, so later price changes do not rewrite old orders.
    priceCents: integer().notNull(),
  },
  (t) => [index('order_items_order_idx').on(t.orderId), check('order_items_quantity_positive', sql`${t.quantity} > 0`)],
)
